/**
 * Outgoing mail: compose → MIME file on disk → outbox row with an undo window
 * → SMTP send with retry → copy to Sent (unless the provider does it) →
 * mark the original as answered/forwarded.
 */
import { join } from 'node:path'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { and, desc, eq, inArray, lte, or, isNull } from 'drizzle-orm'
import nodemailer from 'nodemailer'
import type { DB } from '../db'
import { outbox, type OutboxRow } from '../db/schema'
import type { AccountStore } from '../accounts/AccountStore'
import type { TokenManager } from '../auth/TokenManager'
import type { SettingsStore } from '../settings/SettingsStore'
import type { MessageStore } from './MessageStore'
import type { MessageService } from './MessageService'
import type { SyncEngine } from '../sync/SyncEngine'
import type { IdentityStore } from './IdentityStore'
import type { DraftStore } from './DraftStore'
import { buildMime, appendSignature } from './compose'
import { smtpTransportOptions } from '../accounts/connectionTest'
import type { Draft, OutboxItem } from '@shared/schemas/compose'
import type { ServerConfig } from '@shared/schemas/account'
import { TypedEmitter } from '../utils/emitter'
import { createLogger } from '../utils/logger'
import { backoffDelay } from '../utils/retry'
import { newId } from '../utils/ids'
import { KernelError } from '../utils/result'

export type OutboxEvents = { changed: []; sent: [id: string]; failed: [id: string, error: string] }

const MAX_ATTEMPTS = 8
/** Providers that automatically file sent mail; appending would create duplicates. */
const AUTO_SENT = new Set(['gmail', 'outlook'])

export class OutboxService extends TypedEmitter<OutboxEvents> {
  private readonly log = createLogger('outbox')
  private timer: NodeJS.Timeout | null = null
  private sending = new Set<string>()

  constructor(
    private readonly db: DB,
    private readonly accounts: AccountStore,
    private readonly tokens: TokenManager,
    private readonly settings: SettingsStore,
    private readonly store: MessageStore,
    private readonly mail: MessageService,
    private readonly sync: SyncEngine,
    private readonly identities: IdentityStore,
    private readonly drafts: DraftStore,
    private readonly dataDir: string
  ) {
    super()
  }

  start(): void {
    if (this.timer) return
    this.db.update(outbox).set({ status: 'queued' }).where(eq(outbox.status, 'sending')).run()
    this.timer = setInterval(() => void this.pump(), 3000)
    void this.pump()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  list(): OutboxItem[] {
    return this.db
      .select()
      .from(outbox)
      .where(inArray(outbox.status, ['queued', 'sending', 'failed']))
      .orderBy(desc(outbox.createdAt))
      .all()
      .map(toItem)
  }

  /** Queue a draft for sending. Returns the outbox id (use it for Undo). */
  async send(draft: Draft, opts: { scheduledAt?: Date } = {}): Promise<OutboxItem> {
    const account = this.accounts.get(draft.accountId)
    if (!account) throw new KernelError('ACCOUNT_NOT_FOUND', 'Account not found')
    const identity = (draft.identityId && this.identities.get(draft.identityId)) || this.identities.defaultFor(draft.accountId)
    if (!identity) throw new KernelError('NO_IDENTITY', 'No sending identity for this account')
    if (!draft.to.length && !draft.cc.length && !draft.bcc.length) throw new KernelError('NO_RECIPIENTS', 'Add at least one recipient')

    const original = draft.inReplyToMessageId ? this.store.getMessage(draft.inReplyToMessageId) : undefined
    const sig = identity.signatureId ? this.identities.getSignature(identity.signatureId) : undefined
    const body = appendSignature(draft.html, draft.text, sig && !draft.html.includes('mc-signature') ? sig : undefined)

    const built = await buildMime({
      from: { name: identity.name, address: identity.email },
      replyTo: identity.replyTo,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      html: body.html,
      text: body.text,
      attachments: draft.attachments,
      inReplyTo: original && draft.replyMode !== 'forward' ? original.messageId : null,
      references: original && draft.replyMode !== 'forward' ? [...original.references, ...(original.messageId ? [original.messageId] : [])] : []
    })

    const dir = join(this.dataDir, 'outbox')
    await mkdir(dir, { recursive: true })
    const id = newId('out')
    const mimePath = join(dir, `${id}.eml`)
    await writeFile(mimePath, built.raw)

    const undoSeconds = this.settings.get().compose.undoSendSeconds
    const now = Date.now()
    const undoUntil = opts.scheduledAt ? null : new Date(now + undoSeconds * 1000).toISOString()
    this.db
      .insert(outbox)
      .values({
        id,
        accountId: draft.accountId,
        identityId: identity.id,
        mimePath,
        envelope: built.envelope,
        subject: draft.subject,
        status: 'queued',
        attempts: 0,
        scheduledAt: opts.scheduledAt?.toISOString() ?? undoUntil,
        undoUntil,
        inReplyToMessageId: draft.inReplyToMessageId ?? null,
        replyMode: draft.replyMode ?? null,
        draftJson: draft as unknown as Record<string, unknown>,
        createdAt: new Date(now).toISOString()
      })
      .run()
    // The draft is consumed; it comes back only via Undo.
    const draftRow = this.drafts.remove(draft.id)
    if (draftRow?.serverFolderId && draftRow.serverUid) this.deleteServerDraft(draftRow.accountId, draftRow.serverFolderId, draftRow.serverUid)
    this.emit('changed')
    return toItem(this.get(id)!)
  }

  /** Undo within the window, or cancel a scheduled/failed send. Restores the draft. */
  cancel(id: string): Draft | null {
    const row = this.get(id)
    if (!row || row.status === 'sent' || this.sending.has(id)) return null
    this.db.update(outbox).set({ status: 'cancelled' }).where(eq(outbox.id, id)).run()
    void unlink(row.mimePath).catch(() => {})
    this.emit('changed')
    if (row.draftJson) {
      const d = row.draftJson as unknown as Draft
      return this.drafts.save({ ...d, id: d.id })
    }
    return null
  }

  retry(id: string): void {
    this.db
      .update(outbox)
      .set({ status: 'queued', scheduledAt: new Date().toISOString(), lastError: null })
      .where(eq(outbox.id, id))
      .run()
    this.emit('changed')
    void this.pump()
  }

  private get(id: string): OutboxRow | undefined {
    return this.db.select().from(outbox).where(eq(outbox.id, id)).get()
  }

  private async pump(): Promise<void> {
    const now = new Date().toISOString()
    const due = this.db
      .select()
      .from(outbox)
      .where(and(eq(outbox.status, 'queued'), or(isNull(outbox.scheduledAt), lte(outbox.scheduledAt, now))))
      .all()
    for (const row of due) {
      if (this.sending.has(row.id)) continue
      this.sending.add(row.id)
      void this.deliver(row).finally(() => this.sending.delete(row.id))
    }
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const account = this.accounts.get(row.accountId)
    if (!account) return
    this.db.update(outbox).set({ status: 'sending' }).where(eq(outbox.id, row.id)).run()
    this.emit('changed')
    try {
      const creds = await this.tokens.credentialsFor(account.id)
      const server: ServerConfig = { host: account.smtpHost, port: account.smtpPort, tls: account.smtpTls as ServerConfig['tls'] }
      const transport = nodemailer.createTransport(smtpTransportOptions(server, creds))
      const { readFile } = await import('node:fs/promises')
      const raw = await readFile(row.mimePath)
      try {
        await transport.sendMail({ envelope: row.envelope, raw })
      } finally {
        transport.close()
      }
      this.db.update(outbox).set({ status: 'sent', lastError: null }).where(eq(outbox.id, row.id)).run()
      this.log.info('sent', { id: row.id, to: row.envelope.to.length })

      // Copy to Sent unless the provider does it for us.
      if (!AUTO_SENT.has(account.type)) {
        const sent = this.store.folderBySpecialUse(account.id, 'sent')
        if (sent) this.sync.enqueue(account.id, { kind: 'append', folderPath: sent.path, mimePath: row.mimePath, flags: ['\\Seen'] })
      } else {
        void unlink(row.mimePath).catch(() => {})
      }
      if (row.inReplyToMessageId) {
        this.mail.setFlags([row.inReplyToMessageId], row.replyMode === 'forward' ? { forwarded: true } : { answered: true })
      }
      this.emit('sent', row.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const attempts = row.attempts + 1
      const permanent = attempts >= MAX_ATTEMPTS || /55\d|recipient|rejected|address/i.test(msg)
      this.log.warn('send failed', { id: row.id, attempts, msg, permanent })
      this.db
        .update(outbox)
        .set({
          status: permanent ? 'failed' : 'queued',
          attempts,
          lastError: msg,
          scheduledAt: permanent ? null : new Date(Date.now() + backoffDelay(attempts, { baseMs: 5000, maxMs: 10 * 60_000 })).toISOString()
        })
        .where(eq(outbox.id, row.id))
        .run()
      if (permanent) this.emit('failed', row.id, msg)
    }
    this.emit('changed')
  }

  private deleteServerDraft(accountId: string, folderId: string, uid: number) {
    const folder = this.store.getFolder(folderId)
    if (folder) this.sync.enqueue(accountId, { kind: 'delete', folderPath: folder.path, uids: [uid] })
  }
}

function toItem(r: OutboxRow): OutboxItem {
  return {
    id: r.id,
    accountId: r.accountId,
    subject: r.subject,
    to: r.envelope.to,
    status: r.status as OutboxItem['status'],
    attempts: r.attempts,
    lastError: r.lastError,
    scheduledAt: r.scheduledAt,
    undoUntil: r.undoUntil,
    createdAt: r.createdAt
  }
}
