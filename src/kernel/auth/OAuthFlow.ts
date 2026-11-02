import { randomBytes } from 'node:crypto'
import { googleInteractiveSignIn, type OAuthTokens } from './google'
import { microsoftInteractiveSignIn } from './microsoft'
import type { OAuthConfig } from './oauthConfig'
import type { OAuthStartResult } from '@shared/schemas/oauth'

export interface PendingOAuth extends OAuthTokens {
  provider: 'google' | 'microsoft'
  cacheBlob?: string
  createdAt: number
}

/**
 * Runs interactive OAuth and parks the resulting tokens behind a one-time ticket
 * so that the renderer only ever sees `{ticket, email}`; `accounts.create`
 * redeems the ticket inside the main process.
 */
export class OAuthFlow {
  private pending = new Map<string, PendingOAuth>()

  constructor(
    private readonly config: OAuthConfig,
    private readonly openUrl: (url: string) => Promise<void>
  ) {}

  async start(provider: 'google' | 'microsoft', loginHint?: string, signal?: AbortSignal): Promise<OAuthStartResult> {
    this.gc()
    const cfg = this.config.effective()
    let tokens: PendingOAuth
    if (provider === 'google') {
      const t = await googleInteractiveSignIn({ clientId: cfg.google.clientId, clientSecret: cfg.google.clientSecret, openUrl: this.openUrl, loginHint, signal })
      tokens = { ...t, provider, createdAt: Date.now() }
    } else {
      const t = await microsoftInteractiveSignIn({ clientId: cfg.microsoft.clientId, tenant: cfg.microsoft.tenant, openUrl: this.openUrl, loginHint })
      tokens = { ...t, provider, createdAt: Date.now() }
    }
    const ticket = randomBytes(24).toString('hex')
    this.pending.set(ticket, tokens)
    return { ticket, provider, email: tokens.email, displayName: tokens.displayName }
  }

  /** Peek without consuming (used by the connection test before the account exists). */
  peek(ticket: string): PendingOAuth | undefined {
    return this.pending.get(ticket)
  }

  redeem(ticket: string): PendingOAuth {
    const t = this.pending.get(ticket)
    if (!t) throw new Error('OAuth session expired. Please sign in again.')
    this.pending.delete(ticket)
    return t
  }

  private gc() {
    const cutoff = Date.now() - 15 * 60_000
    for (const [k, v] of this.pending) if (v.createdAt < cutoff) this.pending.delete(k)
  }
}
