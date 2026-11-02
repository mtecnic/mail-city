import type { AccountStore } from '../accounts/AccountStore'
import type { OAuthConfig } from './oauthConfig'
import { googleRefresh } from './google'
import { microsoftRefresh } from './microsoft'
import type { Credentials } from '../accounts/connectionTest'
import { createLogger } from '../utils/logger'
import { KernelError } from '../utils/result'

const log = createLogger('tokens')
const REFRESH_SKEW_MS = 5 * 60_000

/**
 * Hands out IMAP/SMTP credentials for an account, refreshing OAuth access tokens
 * when they are within 5 minutes of expiry. Concurrent refreshes for the same
 * account are coalesced.
 */
export class TokenManager {
  private inflight = new Map<string, Promise<string>>()

  constructor(
    private readonly accounts: AccountStore,
    private readonly oauth: OAuthConfig
  ) {}

  async credentialsFor(accountId: string, opts: { forceRefresh?: boolean } = {}): Promise<Credentials> {
    const acct = this.accounts.get(accountId)
    if (!acct) throw new KernelError('ACCOUNT_NOT_FOUND', `Account ${accountId} not found`)
    if (acct.authType === 'password') {
      const pw = this.accounts.secrets.get(accountId, 'password')
      if (!pw) throw new KernelError('NO_CREDENTIALS', 'No password stored for this account')
      return { user: acct.email, pass: pw.value }
    }
    const token = await this.accessToken(accountId, opts.forceRefresh ?? false)
    return { user: acct.email, accessToken: token }
  }

  async accessToken(accountId: string, forceRefresh = false): Promise<string> {
    if (!forceRefresh) {
      const cached = this.accounts.secrets.get(accountId, 'access_token')
      if (cached && cached.expiresAt && cached.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) return cached.value
    }
    const existing = this.inflight.get(accountId)
    if (existing) return existing
    const p = this.refresh(accountId).finally(() => this.inflight.delete(accountId))
    this.inflight.set(accountId, p)
    return p
  }

  private async refresh(accountId: string): Promise<string> {
    const acct = this.accounts.get(accountId)!
    const cfg = this.oauth.effective()
    log.info('refreshing access token', { accountId, provider: acct.oauthProvider })
    try {
      if (acct.oauthProvider === 'google') {
        const rt = this.accounts.secrets.get(accountId, 'refresh_token')
        if (!rt) throw new KernelError('NO_CREDENTIALS', 'Google sign-in expired. Please sign in again.')
        const r = await googleRefresh({ clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret, refreshToken: rt.value })
        this.accounts.secrets.set(accountId, 'access_token', r.accessToken, r.expiresAt)
        return r.accessToken
      }
      if (acct.oauthProvider === 'microsoft') {
        const blob = this.accounts.secrets.get(accountId, 'oauth_meta')
        if (!blob) throw new KernelError('NO_CREDENTIALS', 'Microsoft sign-in expired. Please sign in again.')
        const r = await microsoftRefresh({ clientId: cfg.microsoft.clientId, tenant: cfg.microsoft.tenant, cacheBlob: blob.value, email: acct.email })
        this.accounts.secrets.set(accountId, 'access_token', r.accessToken, r.expiresAt)
        this.accounts.secrets.set(accountId, 'oauth_meta', r.cacheBlob)
        return r.accessToken
      }
      throw new KernelError('UNSUPPORTED', `Unknown OAuth provider ${acct.oauthProvider}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/invalid_grant|expired|interaction_required|consent_required/i.test(msg)) {
        this.accounts.update(accountId, { lastError: 'Sign-in expired. Please sign in again.' })
        throw new KernelError('REAUTH_REQUIRED', 'Sign-in expired. Please sign in again.', e)
      }
      throw e
    }
  }
}
