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
import { ContactStore } from './contacts/ContactStore'
import { RulesEngine } from './rules/RulesEngine'
import { SnoozeService } from './mail/Snooze'
import { quoteMessage } from './mail/compose'
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
  readonly contacts: ContactStore
  readonly rules: RulesEngine
  readonly snooze: SnoozeService

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
    this.contacts = new ContactStore(this.db)
    this.rules = new RulesEngine(this.db, this.store, this.mail)
    this.snooze = new SnoozeService(this.db, this.store)
    this.wireEvents()
    this.log.info('kernel ready', { dataDir: options.dataDir, vec: this.dbHandle.hasVec })
    if (options.autoSync !== false) {
      this.sync.start()
      this.outbox.start()
      this.snooze.start()
    }
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

  private credsFromRequest(req: CreateAccountRequest): Credentials {
    if (req.auth.type === 'password') return { user: req.email, pass: req.auth.password }
    const t = this.oauth.peek(req.auth.ticket)
    if (!t) throw new Error('OAuth session expired. Please sign in again.')
    return { user: t.email, accessToken: t.accessToken }
  }

  async shutdown(): Promise<void> {
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
