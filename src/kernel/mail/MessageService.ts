/**
 * User-facing mail operations. Every write is applied to the local cache
 * immediately (so the UI is instant and works offline) and queued for the
 * server through the SyncEngine.
 */
import type { MessageStore, ListMessagesQuery, MessageListItem } from './MessageStore'
import type { SyncEngine } from '../sync/SyncEngine'
import type { AccountStore } from '../accounts/AccountStore'
import { IMAP_FLAG } from './flags'
import type { Address, MessageFlags, MessageRow } from '../db/schema'
import { KernelError } from '../utils/result'

export interface MessageDetail {
  id: string
  accountId: string
  folderId: string
  folderPath: string
  threadId: string | null
  subject: string
  from: Address
  to: Address[]
  cc: Address[]
  bcc: Address[]
  replyTo: Address[]
  date: string
  flags: MessageFlags
  labels: string[]
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  listUnsubscribe: string | null
  bodyState: 'headers' | 'full' | 'unavailable'
  textPlain: string | null
  textHtml: string | null
  headers: Record<string, string> | null
  attachments: { id: string; filename: string; mimeType: string; size: number; contentId: string | null; isInline: boolean; available: boolean }[]
  aiSummary: string | null
  aiCategory: string | null
}

export class MessageService {
  constructor(
    private readonly store: MessageStore,
    private readonly engine: SyncEngine,
    private readonly accounts: AccountStore
  ) {}

  list(q: ListMessagesQuery): MessageListItem[] {
    return this.store.list(q)
  }

  thread(threadId: string): MessageListItem[] {
    return this.store.list({ threadId, limit: 500 })
  }

  async get(id: string, opts: { fetchBody?: boolean } = {}): Promise<MessageDetail> {
    let row = this.store.getMessage(id)
    if (!row) throw new KernelError('NOT_FOUND', 'Message not found')
    if (row.bodyState !== 'full' && opts.fetchBody !== false) {
      await this.engine.fetchBody(row.accountId, id)
      row = this.store.getMessage(id) ?? row
    }
    return this.detail(row)
  }

  private detail(row: MessageRow): MessageDetail {
    const body = row.bodyState === 'full' ? this.store.getBody(row.id) : undefined
    const folder = this.store.getFolder(row.folderId)
    return {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      folderPath: folder?.path ?? '',
      threadId: row.threadId,
      subject: row.subject,
      from: { name: row.fromName, address: row.fromAddr },
      to: row.toList,
      cc: row.ccList,
      bcc: row.bccList,
      replyTo: row.replyTo,
      date: row.date,
      flags: row.flags,
      labels: row.labels,
      messageId: row.messageId,
      inReplyTo: row.inReplyTo,
      references: row.references,
      listUnsubscribe: row.listUnsubscribe,
      bodyState: row.bodyState === 'full' ? 'full' : this.engine.get(row.accountId) ? 'headers' : 'unavailable',
      textPlain: body?.textPlain ?? null,
      textHtml: body?.textHtml ?? null,
      headers: body?.headers ?? null,
      attachments: this.store.getAttachments(row.id).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        contentId: a.contentId,
        isInline: a.isInline,
        available: !!a.localPath
      })),
      aiSummary: row.aiSummary,
      aiCategory: row.aiCategory
    }
  }

  /** Local path of a downloaded attachment, fetching the body first if needed. */
  async attachmentPath(attachmentId: string): Promise<{ path: string; filename: string; mimeType: string } | null> {
    let a = this.store.getAttachment(attachmentId)
    if (!a) return null
    if (!a.localPath) {
      const msg = this.store.getMessage(a.messageId)
      if (msg) await this.engine.fetchBody(msg.accountId, msg.id)
      // Body fetch replaces attachment rows; find by filename within the message.
      a = this.store.getAttachments(a.messageId).find((x) => x.filename === a!.filename) ?? a
    }
    return a.localPath ? { path: a.localPath, filename: a.filename, mimeType: a.mimeType } : null
  }

  // ---- actions --------------------------------------------------------------

  setFlags(ids: string[], patch: Partial<MessageFlags>): void {
    const groups = this.groupByFolder(ids)
    this.store.setLocalFlags(ids, patch)
    for (const g of groups.values()) {
      const add = (Object.keys(patch) as (keyof MessageFlags)[]).filter((k) => patch[k]).map((k) => IMAP_FLAG[k])
      const remove = (Object.keys(patch) as (keyof MessageFlags)[]).filter((k) => patch[k] === false).map((k) => IMAP_FLAG[k])
      this.engine.enqueue(g.accountId, { kind: 'setFlags', folderPath: g.folderPath, uids: g.uids, add, remove })
      this.store.refreshFolderCounts(g.folderId)
    }
  }

  markRead(ids: string[], seen = true): void {
    this.setFlags(ids, { seen })
  }

  flag(ids: string[], flagged = true): void {
    this.setFlags(ids, { flagged })
  }

  move(ids: string[], toFolderId: string): void {
    const dest = this.store.getFolder(toFolderId)
    if (!dest) throw new KernelError('NOT_FOUND', 'Destination folder not found')
    for (const g of this.groupByFolder(ids).values()) {
      if (g.accountId !== dest.accountId) throw new KernelError('CROSS_ACCOUNT', 'Cannot move messages between accounts')
      if (g.folderId === dest.id) continue
      for (const id of g.ids) this.store.moveLocal(id, dest.id, null)
      this.engine.enqueue(g.accountId, { kind: 'move', folderPath: g.folderPath, uids: g.uids, toPath: dest.path, messageIds: g.ids })
      this.store.refreshFolderCounts(g.folderId)
      this.store.refreshFolderCounts(dest.id)
    }
  }

  /** Archive: Gmail → All Mail (remove \Inbox label); otherwise → Archive folder (created on demand later). */
  archive(ids: string[]): void {
    for (const g of this.groupByFolder(ids).values()) {
      const acct = this.accounts.get(g.accountId)
      const target = this.store.folderBySpecialUse(g.accountId, 'archive') ?? this.store.folderBySpecialUse(g.accountId, 'all')
      if (!target) {
        if (acct?.type === 'gmail') throw new KernelError('NO_ARCHIVE', 'Gmail All Mail folder not synced yet')
        throw new KernelError('NO_ARCHIVE', 'This account has no Archive folder. Create one named "Archive" on the server.')
      }
      this.move(g.ids, target.id)
    }
  }

  /** Delete: move to Trash, or expunge if already in Trash. */
  delete(ids: string[]): void {
    for (const g of this.groupByFolder(ids).values()) {
      const folder = this.store.getFolder(g.folderId)
      const trash = this.store.folderBySpecialUse(g.accountId, 'trash')
      if (!trash || folder?.specialUse === 'trash' || folder?.specialUse === 'junk') {
        this.store.deleteByIds(g.ids)
        this.engine.enqueue(g.accountId, { kind: 'delete', folderPath: g.folderPath, uids: g.uids })
        this.store.refreshFolderCounts(g.folderId)
      } else {
        this.move(g.ids, trash.id)
      }
    }
  }

  markJunk(ids: string[], junk = true): void {
    for (const g of this.groupByFolder(ids).values()) {
      const target = junk ? this.store.folderBySpecialUse(g.accountId, 'junk') : this.store.folderBySpecialUse(g.accountId, 'inbox')
      if (target) this.move(g.ids, target.id)
    }
  }

  private groupByFolder(ids: string[]) {
    const groups = new Map<string, { accountId: string; folderId: string; folderPath: string; uids: number[]; ids: string[] }>()
    for (const id of ids) {
      const row = this.store.getMessage(id)
      if (!row || row.uid < 0) continue
      const folder = this.store.getFolder(row.folderId)
      if (!folder) continue
      const g = groups.get(folder.id) ?? { accountId: row.accountId, folderId: folder.id, folderPath: folder.path, uids: [], ids: [] }
      g.uids.push(row.uid)
      g.ids.push(id)
      groups.set(folder.id, g)
    }
    return groups
  }
}
