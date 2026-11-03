import { join } from 'node:path'
import { mkdir, copyFile } from 'node:fs/promises'
import type { MessageService } from './MessageService'
import type { IdentityStore } from './IdentityStore'
import type { DraftStore } from './DraftStore'
import type { MessageStore } from './MessageStore'
import type { SyncEngine } from '../sync/SyncEngine'
import { quoteMessage, replyRecipients, replySubject, buildMime } from './compose'
import type { Draft, ReplyMode, ReplyTemplate } from '@shared/schemas/compose'
import { newId } from '../utils/ids'
import { KernelError } from '../utils/result'

/** Reply/forward templates and server-side draft persistence. */
export class ComposeService {
  constructor(
    private readonly mail: MessageService,
    private readonly identities: IdentityStore,
    private readonly drafts: DraftStore,
    private readonly store: MessageStore,
    private readonly sync: SyncEngine,
    private readonly dataDir: string
  ) {}

  async replyTemplate(messageId: string, mode: ReplyMode): Promise<ReplyTemplate> {
    const m = await this.mail.get(messageId)
    const own = this.identities.list(m.accountId).map((i) => i.email)
    const identity = this.identities.matching(m.accountId, [...m.to, ...m.cc].map((a) => a.address)) ?? this.identities.defaultFor(m.accountId)
    const { to, cc } = replyRecipients(m, mode, own)
    const q = quoteMessage(m, mode)
    const attachments =
      mode === 'forward'
        ? await Promise.all(
            m.attachments
              .filter((a) => !a.isInline)
              .map(async (a) => {
                const p = await this.mail.attachmentPath(a.id)
                return p ? { path: p.path, filename: a.filename, size: a.size, mimeType: a.mimeType } : null
              })
          ).then((l) => l.filter((x): x is NonNullable<typeof x> => !!x))
        : []
    return { accountId: m.accountId, identityId: identity?.id ?? null, to, cc, subject: replySubject(m.subject, mode), quotedHtml: q.html, quotedText: q.text, attachments, inReplyToMessageId: m.id, replyMode: mode }
  }

  /** Copy a user-picked file into the drafts area so it survives the original moving. */
  async importAttachment(path: string, filename: string, size: number, mimeType: string): Promise<{ path: string; filename: string; size: number; mimeType: string }> {
    const dir = join(this.dataDir, 'drafts', newId('att'))
    await mkdir(dir, { recursive: true })
    const dest = join(dir, filename.replace(/[\\/:*?"<>|]/g, '_'))
    await copyFile(path, dest)
    return { path: dest, filename, size, mimeType }
  }

  /** Push the current draft to the server's Drafts folder (replacing the previous copy). */
  async syncDraftToServer(draftId: string): Promise<void> {
    const row = this.drafts.getRow(draftId)
    if (!row) throw new KernelError('NOT_FOUND', 'Draft not found')
    const identity = (row.identityId && this.identities.get(row.identityId)) || this.identities.defaultFor(row.accountId)
    const folder = this.store.folderBySpecialUse(row.accountId, 'drafts')
    if (!identity || !folder) return
    const built = await buildMime({
      from: { name: identity.name, address: identity.email },
      to: row.toList,
      cc: row.ccList,
      bcc: row.bccList,
      subject: row.subject,
      html: row.html,
      text: row.text,
      attachments: row.attachments
    })
    const { writeFile } = await import('node:fs/promises')
    const dir = join(this.dataDir, 'drafts')
    await mkdir(dir, { recursive: true })
    const mimePath = join(dir, `${row.id}.eml`)
    await writeFile(mimePath, built.raw)
    if (row.serverFolderId && row.serverUid) {
      const old = this.store.getFolder(row.serverFolderId)
      if (old) this.sync.enqueue(row.accountId, { kind: 'delete', folderPath: old.path, uids: [row.serverUid] })
    }
    this.sync.enqueue(row.accountId, { kind: 'append', folderPath: folder.path, mimePath, flags: ['\\Draft', '\\Seen'], draftId: row.id })
    // The old copy (if any) is queued for deletion above; the new UID arrives via the
    // sync engine's `appended` event once the server answers with APPENDUID.
    this.drafts.setServerLocation(row.id, folder.id, null)
  }

  discardDraft(draftId: string): void {
    const row = this.drafts.remove(draftId)
    if (row?.serverFolderId && row.serverUid) {
      const f = this.store.getFolder(row.serverFolderId)
      if (f) this.sync.enqueue(row.accountId, { kind: 'delete', folderPath: f.path, uids: [row.serverUid] })
    }
  }

  getDraft(id: string): Draft | undefined {
    return this.drafts.get(id)
  }
}
