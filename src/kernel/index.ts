/**
 * Mail kernel facade.
 *
 * Pure Node — no Electron imports. The main process, the MCP stdio entry point
 * and the test-suite all construct a Kernel the same way. Everything the UI or
 * an LLM can do goes through this object.
 */
import { openDb, type DbHandle } from './db'
import { SettingsStore } from './settings/SettingsStore'
import { createLogger } from './utils/logger'
import { KernelError } from './utils/result'
import { sql } from 'drizzle-orm'
import type { SecretCipher } from './accounts/SecretStore'
import { AccountStore, type NewAccountInput } from './accounts/AccountStore'
import { OAuthConfig, type OAuthEnvDefaults } from './auth/oauthConfig'
import { OAuthFlow } from './auth/OAuthFlow'
import { TokenManager } from './auth/TokenManager'
import { discoverAccount, type DiscoveryResult } from './accounts/autodiscovery'
import { testConnection, type ConnectionTestResult, type Credentials } from './accounts/connectionTest'
import { MessageStore } from './mail/MessageStore'
import { MessageService } from './mail/MessageService'
import { SyncEngine } from './sync/SyncEngine'
import { IdentityStore } from './mail/IdentityStore'
import { DraftStore } from './mail/DraftStore'
import { OutboxService } from './mail/Outbox'
import { ComposeService } from './mail/ComposeService'
import { SearchService } from './search/SearchService'
import { FolderService } from './mail/FolderService'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ContactStore } from './contacts/ContactStore'
import { RulesEngine } from './rules/RulesEngine'
import { SnoozeService } from './mail/Snooze'
import { quoteMessage } from './mail/compose'
import { SecretVault } from './utils/vault'
import { AiService } from './ai/AiService'
import { buildMailTools } from './ai/tools/mailTools'
import type { ToolRegistry } from './ai/tools/registry'
import { TypedEmitter } from './utils/emitter'
import { EmbeddingIndexer } from './ai/embeddings/Indexer'
import { Agent } from './ai/agent/Agent'
import { TriageRunner } from './ai/Triage'

export type KernelEvents = {
  /** A draft was created by a tool/agent and should be opened in the UI. */
  draftCreated: [draftId: string]
  /** Messages received AI category/priority. */
  triaged: [messageIds: string[]]
}
import type { ServerConfig } from '@shared/schemas/account'
import type { AccountSummary } from '@shared/schemas/account'

export interface KernelOptions {
  /** Directory for the database, attachments, raw mail and caches. */
  dataDir: string
  /** ':memory:' overrides dataDir for the DB (tests). */
  dbPath?: string
  /** OS-backed encryption for secrets (Electron safeStorage in the app, a no-op cipher in tests). */
  cipher: SecretCipher
  /** Opens a URL in the user's browser (OAuth). */
  openUrl?: (url: string) => Promise<void>
  /** Build-time OAuth client defaults. */
  oauthDefaults?: OAuthEnvDefaults
  /** Start background sync immediately (default true; tests pass false). */
  autoSync?: boolean
}

export type CreateAccountRequest = {
  type: NewAccountInput['type']
  email: string
  displayName: string
  imap: ServerConfig
  smtp: ServerConfig
  auth: { type: 'password'; password: string } | { type: 'oauth2'; ticket: string }
}

export class Kernel {
  readonly log = createLogger('kernel')
  readonly dbHandle: DbHandle
  readonly settings: SettingsStore
  readonly accounts: AccountStore
  readonly oauthConfig: OAuthConfig
  readonly oauth: OAuthFlow
  readonly tokens: TokenManager
  readonly store: MessageStore
  readonly sync: SyncEngine
  readonly mail: MessageService
  readonly identities: IdentityStore
  readonly drafts: DraftStore
  readonly outbox: OutboxService
  readonly compose: ComposeService
  readonly search: SearchService
  readonly folders: FolderService
  readonly contacts: ContactStore
  readonly rules: RulesEngine
  readonly snooze: SnoozeService
  readonly vault: SecretVault
  readonly ai: AiService
  readonly tools: ToolRegistry
  readonly indexer: EmbeddingIndexer
  readonly agent: Agent
  readonly triage: TriageRunner
  readonly events = new TypedEmitter<KernelEvents>()

  constructor(readonly options: KernelOptions) {
    this.dbHandle = openDb({ path: options.dbPath ?? `${options.dataDir}/mail-city.sqlite` })
    this.settings = new SettingsStore(this.db)
    this.accounts = new AccountStore(this.db, options.cipher)
    this.oauthConfig = new OAuthConfig(this.settings, options.oauthDefaults ?? {})
    this.oauth = new OAuthFlow(this.oauthConfig, options.openUrl ?? (async () => {}))
    this.tokens = new TokenManager(this.accounts, this.oauthConfig)
    this.store = new MessageStore(this.db)
    this.sync = new SyncEngine(this.db, this.accounts, this.tokens, this.settings, this.store, options.dataDir)
    this.mail = new MessageService(this.store, this.sync, this.accounts)
    this.identities = new IdentityStore(this.db)
    this.drafts = new DraftStore(this.db)
    this.outbox = new OutboxService(this.db, this.accounts, this.tokens, this.settings, this.store, this.mail, this.sync, this.identities, this.drafts, options.dataDir)
    this.compose = new ComposeService(this.mail, this.identities, this.drafts, this.store, this.sync, options.dataDir)
    this.search = new SearchService(this.dbHandle.raw, this.store, this.accounts)
    this.folders = new FolderService(this.db, this.store, this.sync)
    this.contacts = new ContactStore(this.db)
    this.rules = new RulesEngine(this.db, this.store, this.mail)
    this.snooze = new SnoozeService(this.db, this.store)
    this.vault = new SecretVault(this.settings, options.cipher)
    this.ai = new AiService(this.db, this.settings, this.vault)
    this.tools = buildMailTools(this)
    this.indexer = new EmbeddingIndexer(this.dbHandle.raw, this.db, this.dbHandle.hasVec, this.ai, this.store, this.search, () => this.ai.get().indexWindowDays, () => this.ai.get().enabled && this.ai.get().autoIndex)
    this.agent = new Agent(this.db, this.ai, this.tools, (ctx) => this.agentContext(ctx))
    this.triage = new TriageRunner(this)
    this.wireEvents()
    this.log.info('kernel ready', { dataDir: options.dataDir, vec: this.dbHandle.hasVec })
    if (options.autoSync !== false) {
      this.sync.start()
      this.outbox.start()
      this.snooze.start()
      this.indexer.start()
      this.triage.start()
    }
  }

  /** Volatile context for the assistant: accounts, folders and the message/thread in view. */
  private agentContext(ctx: { accountId?: string; messageId?: string; threadId?: string }): string {
    const accounts = this.accounts
      .list()
      .map((a) => `- ${a.displayName} <${a.email}> (id ${a.id}${a.type ? `, ${a.type}` : ''})`)
      .join('\n')
    const lines = [`Today is ${new Date().toDateString()}.`, `Accounts:\n${accounts}`]
    if (ctx.accountId) lines.push(`The user is currently looking at account ${ctx.accountId}.`)
    if (ctx.messageId) {
      const m = this.store.getMessage(ctx.messageId)
      if (m) lines.push(`The user has this message open: id ${m.id}, thread ${m.threadId ?? 'n/a'}, from ${m.fromName} <${m.fromAddr}>, subject "${m.subject}". When they say "this email" they mean it.`)
    }
    return lines.join('\n\n')
  }

  private wireEvents(): void {
    // Contact harvesting for every cached header.
    this.sync.on('headersStored', (_accountId, folderId, ids) => {
      const folder = this.store.getFolder(folderId)
      const outgoing = folder?.specialUse === 'sent' || folder?.specialUse === 'drafts'
      for (const id of ids) {
        const m = this.store.getMessage(id)
        if (!m) continue
        const when = new Date(m.date)
        if (outgoing) this.contacts.harvest([...m.toList, ...m.ccList, ...m.bccList], 'sent', when)
        else this.contacts.harvest([{ name: m.fromName, address: m.fromAddr }], 'received', when)
      }
    })
    // Rules on genuinely new mail.
    this.sync.on('newMessages', (_accountId, folderId, ids) => {
      const folder = this.store.getFolder(folderId)
      if (folder?.specialUse === 'inbox' || folder?.specialUse === null) void this.rules.run(ids)
    })
    // Rule action "forward": compose a forward and queue it.
    this.rules.setForwardHandler(async (msg, to) => {
      const detail = await this.mail.get(msg.id)
      const q = quoteMessage(detail, 'forward')
      const identity = this.identities.defaultFor(msg.accountId)
      const draft = this.drafts.save({
        accountId: msg.accountId,
        identityId: identity?.id ?? null,
        to: [{ name: '', address: to }],
        subject: /^fwd?:/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`,
        html: q.html,
        text: q.text,
        inReplyToMessageId: msg.id,
        replyMode: 'forward'
      })
      await this.outbox.send(draft)
    })
  }

  get db() {
    return this.dbHandle.db
  }

  // ---- account setup ---------------------------------------------------

  discover(email: string, signal?: AbortSignal): Promise<DiscoveryResult> {
    return discoverAccount(email, { signal })
  }

  /** Test IMAP + SMTP with either a password or a pending OAuth ticket. */
  async testAccount(req: CreateAccountRequest): Promise<ConnectionTestResult> {
    const creds = this.credsFromRequest(req)
    return testConnection(req.imap, req.smtp, creds)
  }

  async createAccount(req: CreateAccountRequest): Promise<AccountSummary> {
    if (req.auth.type === 'password') {
      return this.accounts.create({ ...req, auth: { type: 'password', password: req.auth.password } })
    }
    const t = this.oauth.redeem(req.auth.ticket)
    const summary = this.accounts.create({
      ...req,
      email: t.email || req.email,
      displayName: req.displayName || t.displayName,
      auth: { type: 'oauth2', provider: t.provider, refreshToken: t.refreshToken, accessToken: t.accessToken, expiresAt: t.expiresAt }
    })
    if (t.cacheBlob) this.accounts.secrets.set(summary.id, 'oauth_meta', t.cacheBlob)
    return summary
  }

  // ---- account editing ---------------------------------------------------

  /** Full editable view of an account (no secrets). */
  accountDetail(id: string) {
    const a = this.accounts.get(id)
    if (!a) throw new KernelError('NOT_FOUND', 'Account not found')
    return {
      id: a.id,
      type: a.type as 'gmail' | 'outlook' | 'icloud' | 'yahoo' | 'imap',
      email: a.email,
      displayName: a.displayName,
      color: a.color,
      enabled: a.enabled,
      authType: a.authType as 'oauth2' | 'password',
      oauthProvider: (a.oauthProvider ?? null) as 'google' | 'microsoft' | null,
      imap: { host: a.imapHost, port: a.imapPort, tls: a.imapTls as ServerConfig['tls'] },
      smtp: { host: a.smtpHost, port: a.smtpPort, tls: a.smtpTls as ServerConfig['tls'] },
      syncSettings: a.syncSettings as { initialWindowDays?: number },
      lastError: a.lastError,
      lastSyncAt: a.lastSyncAt
    }
  }

  async updateAccount(id: string, patch: { displayName?: string; color?: string; enabled?: boolean; imap?: ServerConfig; smtp?: ServerConfig; syncSettings?: Record<string, unknown> }): Promise<void> {
    const row: Parameters<AccountStore['update']>[1] = {}
    if (patch.displayName !== undefined) row.displayName = patch.displayName
    if (patch.color !== undefined) row.color = patch.color
    if (patch.enabled !== undefined) row.enabled = patch.enabled
    if (patch.syncSettings) row.syncSettings = { ...(this.accounts.get(id)?.syncSettings ?? {}), ...patch.syncSettings }
    let restart = false
    if (patch.imap) {
      Object.assign(row, { imapHost: patch.imap.host, imapPort: patch.imap.port, imapTls: patch.imap.tls })
      restart = true
    }
    if (patch.smtp) Object.assign(row, { smtpHost: patch.smtp.host, smtpPort: patch.smtp.port, smtpTls: patch.smtp.tls })
    if (restart) row.lastError = null
    this.accounts.update(id, row)
    if (restart) await this.sync.restart(id)
  }

  async setAccountPassword(id: string, password: string): Promise<void> {
    const a = this.accounts.get(id)
    if (!a) throw new KernelError('NOT_FOUND', 'Account not found')
    this.accounts.secrets.set(id, 'password', password)
    this.accounts.secrets.delete(id, 'access_token')
    this.accounts.update(id, { lastError: null })
    if (a.authType !== 'password') this.db.run(sql`UPDATE accounts SET auth_type = 'password', oauth_provider = NULL WHERE id = ${id}`)
    await this.sync.restart(id)
  }

  /** Redeem a fresh OAuth ticket for an existing account (re-auth or switch from password). */
  async reauthAccount(id: string, ticket: string): Promise<void> {
    const a = this.accounts.get(id)
    if (!a) throw new KernelError('NOT_FOUND', 'Account not found')
    const t = this.oauth.redeem(ticket)
    if (t.email.toLowerCase() !== a.email.toLowerCase()) throw new KernelError('WRONG_ACCOUNT', `You signed in as ${t.email}, but this account is ${a.email}`)
    this.accounts.secrets.set(id, 'refresh_token', t.refreshToken)
    this.accounts.secrets.set(id, 'access_token', t.accessToken, t.expiresAt)
    if (t.cacheBlob) this.accounts.secrets.set(id, 'oauth_meta', t.cacheBlob)
    this.db.run(sql`UPDATE accounts SET auth_type = 'oauth2', oauth_provider = ${t.provider}, last_error = NULL WHERE id = ${id}`)
    this.accounts.emit('changed')
    await this.sync.restart(id)
  }

  /** Test the stored credentials of an existing account. */
  async testExistingAccount(id: string): Promise<ConnectionTestResult> {
    const a = this.accountDetail(id)
    const creds = await this.tokens.credentialsFor(id)
    return testConnection(a.imap, a.smtp, creds)
  }

  /** Raw RFC822 source of a message, saved under dataDir/raw. */
  async messageSource(id: string): Promise<{ path: string; text: string } | null> {
    const m = this.store.getMessage(id)
    if (!m) return null
    const raw = await this.sync.fetchSource(m.accountId, id)
    if (!raw) return null
    const dir = join(this.options.dataDir, 'raw')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${id}.eml`)
    await writeFile(path, raw)
    return { path, text: raw.toString('utf8', 0, Math.min(raw.length, 200_000)) }
  }

  private credsFromRequest(req: CreateAccountRequest): Credentials {
    if (req.auth.type === 'password') return { user: req.email, pass: req.auth.password }
    const t = this.oauth.peek(req.auth.ticket)
    if (!t) throw new Error('OAuth session expired. Please sign in again.')
    return { user: t.email, accessToken: t.accessToken }
  }

  async shutdown(): Promise<void> {
    this.indexer.stop()
    this.snooze.stop()
    this.outbox.stop()
    await this.sync.stop()
    this.dbHandle.close()
  }
}

export type { SecretCipher } from './accounts/SecretStore'
export type { DiscoveryResult } from './accounts/autodiscovery'
export type { ConnectionTestResult } from './accounts/connectionTest'
export type { MessageListItem, ListMessagesQuery } from './mail/MessageStore'
export type { MessageDetail } from './mail/MessageService'
