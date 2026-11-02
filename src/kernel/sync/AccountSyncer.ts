import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { ParsedMail } from 'mailparser'
import type { AccountRow, FolderRow } from '../db/schema'
import { ImapProvider } from '../providers/ImapProvider'
import type { MessageStore } from '../mail/MessageStore'
import { OpQueue, type PendingOp } from './OpQueue'
import { specialUseFromImap, folderSortKey, EAGER_SPECIAL_USE } from '../mail/folders'
import { htmlToText, makeSnippet } from '../mail/text'
import { newId } from '../utils/ids'
import { createLogger, type Logger } from '../utils/logger'
import { backoffDelay, sleep } from '../utils/retry'
import { TypedEmitter } from '../utils/emitter'
import type { Credentials } from '../accounts/connectionTest'
import type { ServerConfig } from '@shared/schemas/account'

export type SyncState = 'idle' | 'syncing' | 'error' | 'offline'

export type SyncerEvents = {
  status: [state: SyncState, detail?: string]
  foldersChanged: []
  messagesChanged: [folderId: string]
  /** New messages that arrived after the initial import (notifications, rules). */
  newMessages: [folderId: string, messageIds: string[]]
  /** Every newly cached header, including during the initial import (contact harvesting, indexing). */
  headersStored: [folderId: string, messageIds: string[]]
  bodyFetched: [messageId: string]
}

export interface SyncerDeps {
  store: MessageStore
  ops: OpQueue
  getCredentials: (forceRefresh: boolean) => Promise<Credentials>
  dataDir: string
  settings: () => { initialWindowDays: number; pollIntervalMinutes: number }
  onAccountError: (error: string | null) => void
  /** Test hook: supply a fake provider instead of a real IMAP connection. */
  createProvider?: (accountId: string, server: ServerConfig) => ImapProvider
}

const HEADER_BATCH = 500

/**
 * Owns one IMAP connection for an account and keeps the local cache in sync:
 * folder list, eager folders (inbox/sent/drafts), IDLE on INBOX, periodic
 * polling of other folders, replay of queued operations, on-demand bodies.
 */
export class AccountSyncer extends TypedEmitter<SyncerEvents> {
  readonly provider: ImapProvider
  private readonly log: Logger
  private running = false
  private loopPromise: Promise<void> | null = null
  private wake: (() => void) | null = null
  private failures = 0
  private lastPoll = 0
  private folderSyncRequests = new Set<string>()
  private bodyRequests: { messageId: string; resolve: (ok: boolean) => void }[] = []
  private state: SyncState = 'idle'
  private fullResyncRequested = true
  private readonly mutex = new Mutex()

  constructor(
    readonly account: AccountRow,
    private readonly deps: SyncerDeps
  ) {
    super()
    this.log = createLogger(`sync:${account.email}`)
    const server: ServerConfig = { host: account.imapHost, port: account.imapPort, tls: account.imapTls as ServerConfig['tls'] }
    this.provider = deps.createProvider ? deps.createProvider(account.id, server) : new ImapProvider(account.id, server, deps.getCredentials)
    this.provider.on('exists', (path) => this.onServerChange(path))
    this.provider.on('expunge', (path) => this.onServerChange(path))
    this.provider.on('flags', (path) => this.onServerChange(path))
    this.provider.on('close', () => this.kick())
  }

  get accountId() {
    return this.account.id
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.deps.ops.resetRunning(this.account.id)
    this.loopPromise = this.loop().catch((e) => this.log.error('sync loop crashed', e))
  }

  async stop(): Promise<void> {
    this.running = false
    this.kick()
    await this.loopPromise
    await this.provider.disconnect()
  }

  /** Wake the loop (new op queued, folder opened, etc). */
  kick(): void {
    this.wake?.()
  }

  requestFolderSync(folderId: string): void {
    this.folderSyncRequests.add(folderId)
    this.kick()
  }

  requestFullResync(): void {
    this.fullResyncRequested = true
    this.kick()
  }

  /** Fetch and store a message body; resolves when stored. */
  fetchBody(messageId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.bodyRequests.push({ messageId, resolve })
      this.kick()
    })
  }

  enqueue(op: PendingOp): void {
    this.deps.ops.enqueue(this.account.id, op)
    this.kick()
  }

  private setState(state: SyncState, detail?: string) {
    if (this.state !== state || detail) {
      this.state = state
      this.emit('status', state, detail)
    }
  }

  private onServerChange(path: string) {
    const f = this.deps.store.folderByPath(this.account.id, path)
    if (f) this.requestFolderSync(f.id)
  }

  // ---- main loop ----------------------------------------------------------

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.provider.connect()
        this.failures = 0
        this.deps.onAccountError(null)
        await this.tick()
        this.setState('idle')
        await this.waitForWork()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.failures++
        this.log.warn('sync error', { msg, failures: this.failures })
        this.setState(/ENOTFOUND|ECONN|ETIMEDOUT|offline|timed out/i.test(msg) ? 'offline' : 'error', msg)
        this.deps.onAccountError(msg)
        if (/sign in again|REAUTH/i.test(msg)) {
          // Nothing we can do until the user re-authenticates; back off hard.
          await this.waitForWork(10 * 60_000)
        } else {
          await this.provider.disconnect().catch(() => {})
          await sleep(backoffDelay(Math.min(this.failures, 6), { baseMs: 2000, maxMs: 5 * 60_000 })).catch(() => {})
        }
      }
    }
  }

  private async waitForWork(maxMs?: number): Promise<void> {
    const pollMs = this.deps.settings().pollIntervalMinutes * 60_000
    const timeout = maxMs ?? Math.max(5_000, pollMs - (Date.now() - this.lastPoll))
    const idle = this.idleInbox()
    await Promise.race([
      new Promise<void>((resolve) => {
        this.wake = resolve
        setTimeout(resolve, timeout)
      }),
      idle
    ])
    this.wake = null
  }

  /** Keep INBOX selected and let imapflow IDLE on it; server events wake the loop. */
  private async idleInbox(): Promise<void> {
    const inbox = this.deps.store.folderBySpecialUse(this.account.id, 'inbox')
    if (!inbox || !this.provider.connected) return
    try {
      const mb = this.provider.currentMailbox
      if (!mb || mb.path !== inbox.path) await this.provider.open(inbox.path)
      await this.provider.idle()
    } catch (e) {
      this.log.debug('idle ended', { error: String(e) })
    }
  }

  /** Run one sync pass now (used by tests and "sync now"). */
  async tick(): Promise<void> {
    await this.mutex.run(async () => {
      this.setState('syncing')
      await this.replayOps()
      if (this.fullResyncRequested) {
        this.fullResyncRequested = false
        await this.syncFolderList()
        for (const f of this.deps.store.listFolders(this.account.id)) {
          if (f.specialUse && EAGER_SPECIAL_USE.includes(f.specialUse as never)) this.folderSyncRequests.add(f.id)
        }
        this.lastPoll = Date.now()
      }
      await this.serveBodyRequests()
      const pollDue = Date.now() - this.lastPoll > this.deps.settings().pollIntervalMinutes * 60_000
      if (pollDue) {
        this.lastPoll = Date.now()
        for (const f of this.deps.store.listFolders(this.account.id)) if (f.syncEnabled && f.lastSyncAt) this.folderSyncRequests.add(f.id)
      }
      const requests = [...this.folderSyncRequests]
      this.folderSyncRequests.clear()
      // Inbox first.
      requests.sort((a, b) => (this.deps.store.getFolder(a)?.specialUse === 'inbox' ? -1 : 0) - (this.deps.store.getFolder(b)?.specialUse === 'inbox' ? -1 : 0))
      for (const id of requests) {
        const f = this.deps.store.getFolder(id)
        if (f) await this.syncFolder(f)
      }
      await this.serveBodyRequests()
    })
  }

  // ---- folders ------------------------------------------------------------

  async syncFolderList(): Promise<void> {
    const remote = await this.provider.listFolders()
    const seen = new Set<string>()
    const existing = this.deps.store.listFolders(this.account.id)
    for (const f of remote) {
      const specialUse = specialUseFromImap(f.specialUse, f.path)
      seen.add(f.path)
      this.deps.store.upsertFolder({
        id: existing.find((e) => e.path === f.path)?.id ?? newId('fld'),
        accountId: this.account.id,
        path: f.path,
        name: f.path.toUpperCase() === 'INBOX' ? 'Inbox' : f.name,
        delimiter: f.delimiter,
        specialUse,
        subscribed: f.subscribed,
        sortOrder: folderSortKey(specialUse, f.path).length // placeholder, re-sorted below
      })
    }
    for (const e of existing) if (!seen.has(e.path)) this.deps.store.deleteFolder(e.id)
    // Assign sort order: special-use first, then alphabetical by path.
    const all = this.deps.store.listFolders(this.account.id).sort((a, b) => folderSortKey(a.specialUse, a.path).localeCompare(folderSortKey(b.specialUse, b.path)))
    all.forEach((f, i) => this.deps.store.updateFolder(f.id, { sortOrder: i }))
    this.emit('foldersChanged')
  }

  async syncFolder(folder: FolderRow): Promise<void> {
    const started = Date.now()
    const mb = await this.provider.open(folder.path)
    const store = this.deps.store
    const uidValidity = Number(mb.uidValidity)
    let changed = false
    const newIds: string[] = []

    if (folder.uidValidity !== null && folder.uidValidity !== uidValidity) {
      this.log.warn('UIDVALIDITY changed; clearing folder cache', { path: folder.path })
      store.clearFolderMessages(folder.id)
      folder = { ...folder, uidValidity: null, uidNext: null, highestModSeq: null, lastSyncAt: null }
      changed = true
    }

    const local = store.uidsInFolder(folder.id)
    const isInitial = folder.lastSyncAt === null
    const windowDays = this.deps.settings().initialWindowDays

    // 1. New messages.
    let targetUids: number[]
    if (isInitial) {
      const since = new Date(Date.now() - windowDays * 86_400_000)
      targetUids = (await this.provider.uidsSince(since)).filter((u) => !local.has(u))
    } else {
      const from = Math.max(folder.uidNext ?? 1, store.maxUid(folder.id) + 1)
      targetUids = mb.uidNext > from ? [`${from}:*` as unknown as number] : []
    }
    if (targetUids.length) {
      const batches: (string | number[])[] = typeof targetUids[0] === 'string' ? [targetUids[0] as unknown as string] : chunk(targetUids as number[], HEADER_BATCH)
      for (const b of batches) {
        for await (const h of this.provider.fetchHeaders(b)) {
          if (local.has(h.uid)) continue
          const r = store.upsertHeader(this.account.id, folder.id, h)
          if (r.isNew) newIds.push(r.id)
          changed = true
        }
      }
    }

    // 2. Flag changes + deletions for already-cached messages.
    if (!isInitial && local.size) {
      if (this.provider.supportsCondstore && folder.highestModSeq && mb.highestModseq) {
        const since = BigInt(folder.highestModSeq)
        if (mb.highestModseq > since) {
          for await (const f of this.provider.fetchFlags('1:*', { changedSince: since })) {
            if (store.updateFlags(folder.id, f.uid, f.flags, f.labels)) changed = true
          }
        }
      } else {
        // No CONDSTORE: refresh flags for the most recent window only (cheap enough).
        const recent = [...local.keys()].sort((a, b) => b - a).slice(0, 1000)
        if (recent.length) {
          for await (const f of this.provider.fetchFlags(`${recent[recent.length - 1]}:${recent[0]}`)) {
            if (store.updateFlags(folder.id, f.uid, f.flags, f.labels)) changed = true
          }
        }
      }
      // Deletions: diff the server's UID list against ours. `exists` can't be used
      // as a shortcut because we only cache a date window of the folder.
      {
        const serverUids = new Set(await this.provider.allUids())
        const gone = [...local.keys()].filter((u) => u > 0 && !serverUids.has(u))
        if (gone.length) {
          store.deleteByUids(folder.id, gone)
          changed = true
        }
      }
    }

    // 3. Resolve placeholder UIDs created by optimistic local moves.
    const placeholders = [...store.uidsInFolder(folder.id)].filter(([uid]) => uid < 0)
    if (placeholders.length) {
      const serverUids = new Set(await this.provider.allUids())
      const unknown = [...serverUids].filter((u) => !local.has(u) && u > 0)
      // Fetch headers for UIDs we don't have and match by Message-ID.
      for await (const h of this.provider.fetchHeaders(unknown.slice(-200))) {
        const existing = placeholders.find(([, id]) => store.getMessage(id)?.messageId === h.envelope.messageId)
        if (existing) {
          store.moveLocal(existing[1], folder.id, h.uid)
          placeholders.splice(placeholders.indexOf(existing), 1)
        } else if (!store.getByUid(folder.id, h.uid)) {
          const r = store.upsertHeader(this.account.id, folder.id, h)
          if (r.isNew) newIds.push(r.id)
        }
        changed = true
      }
      // Anything still unresolved is dropped; the next full compare will refetch if needed.
      store.deleteByIds(placeholders.map(([, id]) => id))
    }

    store.updateFolder(folder.id, {
      uidValidity,
      uidNext: mb.uidNext,
      highestModSeq: mb.highestModseq ? mb.highestModseq.toString() : folder.highestModSeq,
      lastSyncAt: new Date().toISOString()
    })
    store.refreshFolderCounts(folder.id)
    this.emit('foldersChanged')
    if (changed) this.emit('messagesChanged', folder.id)
    if (newIds.length) this.emit('headersStored', folder.id, newIds)
    if (newIds.length && !isInitial) this.emit('newMessages', folder.id, newIds)
    this.log.info('folder synced', { path: folder.path, new: newIds.length, ms: Date.now() - started })
  }

  // ---- bodies -------------------------------------------------------------

  private async serveBodyRequests(): Promise<void> {
    while (this.bodyRequests.length) {
      const req = this.bodyRequests.shift()!
      try {
        req.resolve(await this.fetchAndStoreBody(req.messageId))
      } catch (e) {
        this.log.warn('body fetch failed', { id: req.messageId, error: String(e) })
        req.resolve(false)
      }
    }
  }

  private async fetchAndStoreBody(messageId: string): Promise<boolean> {
    const store = this.deps.store
    const msg = store.getMessage(messageId)
    if (!msg) return false
    if (msg.bodyState === 'full') return true
    const folder = store.getFolder(msg.folderId)
    if (!folder || msg.uid < 0) return false
    const mb = this.provider.currentMailbox
    if (!mb || mb.path !== folder.path) await this.provider.open(folder.path)
    const result = await this.provider.fetchParsed(msg.uid)
    if (!result) return false
    const { parsed } = result
    const dir = join(this.deps.dataDir, 'attachments', this.account.id, messageId)
    const atts = await this.persistAttachments(parsed, dir)
    const html = parsed.html || null
    const text = parsed.text || (html ? htmlToText(html) : '') || null
    const headers: Record<string, string> = {}
    for (const [k, v] of parsed.headers) headers[k] = typeof v === 'string' ? v : JSON.stringify(v)
    store.saveBody(messageId, { textPlain: text, textHtml: html, headers, snippet: makeSnippet(text ?? '') })
    store.replaceAttachments(messageId, atts)
    this.emit('bodyFetched', messageId)
    this.emit('messagesChanged', folder.id)
    return true
  }

  private async persistAttachments(parsed: ParsedMail, dir: string) {
    const out: { part: string | null; filename: string; mimeType: string; size: number; contentId: string | null; isInline: boolean; localPath: string | null }[] = []
    if (!parsed.attachments?.length) return out
    await mkdir(dir, { recursive: true })
    const used = new Set<string>()
    for (const a of parsed.attachments) {
      const safe = sanitizeFilename(a.filename ?? `attachment.${(a.contentType ?? 'bin').split('/')[1] ?? 'bin'}`)
      let name = safe
      for (let i = 2; used.has(name); i++) name = safe.replace(/(\.[^.]*)?$/, ` (${i})$1`)
      used.add(name)
      const localPath = join(dir, name)
      await writeFile(localPath, a.content)
      const cid = a.contentId ? a.contentId.replace(/^<|>$/g, '') : null
      out.push({
        part: null,
        filename: a.filename ?? name,
        mimeType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? a.content.length,
        contentId: cid,
        isInline: a.contentDisposition === 'inline' && !!cid,
        localPath
      })
    }
    return out
  }

  // ---- queued operations --------------------------------------------------

  private async replayOps(): Promise<void> {
    const ops = this.deps.ops
    for (;;) {
      const row = ops.next(this.account.id)
      if (!row) break
      ops.markRunning(row.id)
      const op = row.payload as PendingOp
      try {
        await this.applyOp(op)
        ops.complete(row.id)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const permanent = /NONEXISTENT|Unknown Mailbox|does not exist|invalid/i.test(msg) || row.attempts >= 5
        this.log.warn('op failed', { kind: op.kind, msg, permanent })
        ops.fail(row.id, msg, permanent)
        if (!permanent) throw e // connection trouble: leave loop, retry later
      }
    }
  }

  private async applyOp(op: PendingOp): Promise<void> {
    const p = this.provider
    const ensureOpen = async (path: string) => {
      const mb = p.currentMailbox
      if (!mb || mb.path !== path) await p.open(path)
    }
    switch (op.kind) {
      case 'setFlags':
        await ensureOpen(op.folderPath)
        if (op.add.length) await p.addFlags(op.uids, op.add)
        if (op.remove.length) await p.removeFlags(op.uids, op.remove)
        return
      case 'setLabels':
        await ensureOpen(op.folderPath)
        if (op.add.length) await p.addLabels(op.uids, op.add)
        if (op.remove.length) await p.removeLabels(op.uids, op.remove)
        return
      case 'move': {
        await ensureOpen(op.folderPath)
        const map = await p.move(op.uids, op.toPath)
        const dest = this.deps.store.folderByPath(this.account.id, op.toPath)
        if (dest) {
          op.messageIds.forEach((id, i) => {
            const newUid = map?.get(op.uids[i]!) ?? null
            const row = this.deps.store.getMessage(id)
            if (row && row.folderId === dest.id && newUid) this.deps.store.moveLocal(id, dest.id, newUid)
          })
          this.folderSyncRequests.add(dest.id)
        }
        const src = this.deps.store.folderByPath(this.account.id, op.folderPath)
        if (src) this.folderSyncRequests.add(src.id)
        return
      }
      case 'delete':
        await ensureOpen(op.folderPath)
        await p.deletePermanently(op.uids)
        return
      case 'append': {
        const { readFile } = await import('node:fs/promises')
        const mime = await readFile(op.mimePath)
        const uid = await p.append(op.folderPath, mime, op.flags)
        const dest = this.deps.store.folderByPath(this.account.id, op.folderPath)
        if (dest) {
          if (op.messageId && uid) this.deps.store.moveLocal(op.messageId, dest.id, uid)
          this.folderSyncRequests.add(dest.id)
        }
        return
      }
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'attachment'
}

class Mutex {
  private chain: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => {})
    return next
  }
}
