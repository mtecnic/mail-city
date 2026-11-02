import { PublicClientApplication, type AccountInfo } from '@azure/msal-node'
import type { OAuthTokens } from './google'
import { createLogger } from '../utils/logger'

const log = createLogger('oauth:microsoft')

export const MS_SCOPES = ['https://outlook.office.com/IMAP.AccessAsUser.All', 'https://outlook.office.com/SMTP.Send', 'offline_access']

export interface MicrosoftOAuthOptions {
  clientId: string
  tenant: string
  openUrl: (url: string) => Promise<void>
  loginHint?: string
}

function pca(clientId: string, tenant: string, cacheBlob?: string): PublicClientApplication {
  const app = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenant || 'common'}` },
    system: { loggerOptions: { piiLoggingEnabled: false, logLevel: 0 } }
  })
  if (cacheBlob) app.getTokenCache().deserialize(cacheBlob)
  return app
}

/** Interactive sign-in. MSAL hosts its own loopback listener. Returns tokens + serialized cache (needed for silent refresh). */
export async function microsoftInteractiveSignIn(opts: MicrosoftOAuthOptions): Promise<OAuthTokens & { cacheBlob: string }> {
  if (!opts.clientId) throw new Error('No Microsoft client ID configured. Add one in Settings → Accounts → OAuth clients.')
  const app = pca(opts.clientId, opts.tenant)
  const result = await app.acquireTokenInteractive({
    scopes: MS_SCOPES,
    openBrowser: opts.openUrl,
    loginHint: opts.loginHint,
    prompt: 'select_account',
    successTemplate: '<html><body style="font-family:system-ui"><h1>Signed in</h1><p>You can close this tab and return to Mail City.</p></body></html>',
    errorTemplate: '<html><body style="font-family:system-ui"><h1>Sign-in failed</h1></body></html>'
  })
  const email = result.account?.username
  if (!email) throw new Error('Could not determine the signed-in Microsoft account email')
  log.info('signed in', { email })
  return {
    accessToken: result.accessToken,
    refreshToken: '', // MSAL keeps refresh tokens inside its serialized cache
    expiresAt: result.expiresOn ?? new Date(Date.now() + 55 * 60_000),
    email,
    displayName: result.account?.name ?? email,
    cacheBlob: app.getTokenCache().serialize()
  }
}

export async function microsoftRefresh(opts: { clientId: string; tenant: string; cacheBlob: string; email: string }): Promise<{ accessToken: string; expiresAt: Date; cacheBlob: string }> {
  const app = pca(opts.clientId, opts.tenant, opts.cacheBlob)
  const accounts = await app.getAllAccounts()
  const account: AccountInfo | undefined = accounts.find((a) => a.username.toLowerCase() === opts.email.toLowerCase()) ?? accounts[0]
  if (!account) throw new Error('Microsoft sign-in has expired. Please sign in again.')
  const result = await app.acquireTokenSilent({ account, scopes: MS_SCOPES, forceRefresh: true })
  return { accessToken: result.accessToken, expiresAt: result.expiresOn ?? new Date(Date.now() + 55 * 60_000), cacheBlob: app.getTokenCache().serialize() }
}
