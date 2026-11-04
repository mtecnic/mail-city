import type { AccountStore } from '../accounts/AccountStore'
import type { TokenManager } from '../auth/TokenManager'
import type { SettingsStore } from '../settings/SettingsStore'
import type { MessageStore } from '../mail/MessageStore'
import { OpQueue, type PendingOp } from './OpQueue'
import { AccountSyncer, type SyncState } from './AccountSyncer'
import type { DB } from '../db'
import { TypedEmitter } from '../utils/emitter'
import { createLogger } from '../utils/logger'

export type EngineEvents = {
  status: [accountId: string, state: SyncState, detail?: string]
  foldersChanged: [accountId: string]
  messagesChanged: [accountId: string, folderId: string]
  newMessages: [accountId: string, folderId: string, messageIds: string[]]
  headersStored: [accountId: string, folderId: string, messageIds: string[]]
  bodyFetched: [messageId: string]
  appended: [accountId: string, folderId: string, uid: number | undefined, op: Extract<PendingOp, { kind: 'append' }>]
}

/** Supervises one AccountSyncer per enabled account. */
export class SyncEngine extends TypedEmitter<EngineEvents> {
  readonly ops: OpQueue
  private syncers = new Map<string, AccountSyncer>()
  private readonly log = createLogger('sync')
  private started = false

  constructor(
    db: DB,
    private readonly accounts: AccountStore,
    private readonly tokens: TokenManager,
    private readonly settings: SettingsStore,
    private readonly store: MessageStore,
    private readonly dataDir: string
  ) {
    super()
    this.ops = new OpQueue(db)
    accounts.on('changed', () => {
      if (this.started) void this.reconcile()
    })
  }

  start(): void {
    this.started = true
    void this.reconcile()
  }

  async stop(): Promise<void> {
    this.started = false
    await Promise.all([...this.syncers.values()].map((s) => s.stop()))
    this.syncers.clear()
  }

  get(accountId: string): AccountSyncer | undefined {
    return this.syncers.get(accountId)
  }

  enqueue(accountId: string, op: PendingOp): void {
    const s = this.syncers.get(accountId)
    if (s) s.enqueue(op)
    else this.ops.enqueue(accountId, op)
  }

  syncNow(accountId?: string): void {
    for (const s of this.syncers.values()) if (!accountId || s.accountId === accountId) s.requestFullResync()
  }

  requestFolderSync(accountId: string, folderId: string): void {
    this.syncers.get(accountId)?.requestFolderSync(folderId)
  }

  fetchBody(accountId: string, messageId: string): Promise<boolean> {
    const s = this.syncers.get(accountId)
    return s ? s.fetchBody(messageId) : Promise.resolve(false)
  }

  fetchSource(accountId: string, messageId: string): Promise<Buffer | null> {
    const s = this.syncers.get(accountId)
    return s ? s.fetchSource(messageId) : Promise.resolve(null)
  }

  /** Tear down and recreate an account's syncer (after server/credential changes). */
  async restart(accountId: string): Promise<void> {
    const s = this.syncers.get(accountId)
    if (s) {
      this.syncers.delete(accountId)
      await s.stop()
    }
    if (this.started) await this.reconcile()
  }

  private async reconcile(): Promise<void> {
    const wanted = this.accounts.list().filter((a) => a.enabled)
    for (const [id, s] of this.syncers) {
      if (!wanted.some((a) => a.id === id)) {
        this.syncers.delete(id)
        await s.stop()
      }
    }
    for (const a of wanted) {
      if (this.syncers.has(a.id)) continue
      const row = this.accounts.get(a.id)
      if (!row) continue
      const syncer = new AccountSyncer(row, {
        store: this.store,
        ops: this.ops,
        getCredentials: (force) => this.tokens.credentialsFor(a.id, { forceRefresh: force }),
        dataDir: this.dataDir,
        settings: () => this.settings.get().sync,
        onAccountError: (err) => {
          const current = this.accounts.get(a.id)
          if (current && current.lastError !== err) this.accounts.update(a.id, { lastError: err, ...(err ? {} : { lastSyncAt: new Date().toISOString() }) })
        }
      })
      syncer.on('status', (state, detail) => this.emit('status', a.id, state, detail))
      syncer.on('foldersChanged', () => this.emit('foldersChanged', a.id))
      syncer.on('messagesChanged', (folderId) => this.emit('messagesChanged', a.id, folderId))
      syncer.on('newMessages', (folderId, ids) => this.emit('newMessages', a.id, folderId, ids))
      syncer.on('headersStored', (folderId, ids) => this.emit('headersStored', a.id, folderId, ids))
      syncer.on('bodyFetched', (id) => this.emit('bodyFetched', id))
      syncer.on('appended', (folderId, uid, op) => this.emit('appended', a.id, folderId, uid, op))
      this.syncers.set(a.id, syncer)
      this.log.info('starting syncer', { account: a.email })
      syncer.start()
    }
  }
}
