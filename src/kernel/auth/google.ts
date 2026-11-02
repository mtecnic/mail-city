import { OAuth2Client } from 'google-auth-library'
import { randomBytes } from 'node:crypto'
import { waitForLoopbackCallback } from './loopback'
import { createLogger } from '../utils/logger'

const log = createLogger('oauth:google')

export const GOOGLE_SCOPES = ['https://mail.google.com/', 'openid', 'email', 'profile']

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  email: string
  displayName: string
}

export interface GoogleOAuthOptions {
  clientId: string
  clientSecret: string
  openUrl: (url: string) => Promise<void>
  loginHint?: string
  signal?: AbortSignal
}

export async function googleInteractiveSignIn(opts: GoogleOAuthOptions): Promise<OAuthTokens> {
  if (!opts.clientId) throw new Error('No Google OAuth client ID configured. Add one in Settings → Accounts → OAuth clients.')
  const loopback = await waitForLoopbackCallback({ signal: opts.signal })
  const client = new OAuth2Client({ clientId: opts.clientId, clientSecret: opts.clientSecret || undefined, redirectUri: loopback.redirectUri })
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const state = randomBytes(16).toString('hex')
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always get a refresh token
    scope: GOOGLE_SCOPES,
    state,
    login_hint: opts.loginHint,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as never
  })
  await opts.openUrl(url)

  const cb = await loopback.result
  if (cb.error) throw new Error(cb.errorDescription ?? cb.error)
  if (cb.state !== state) throw new Error('OAuth state mismatch')
  if (!cb.code) throw new Error('No authorization code received')

  const { tokens } = await client.getToken({ code: cb.code, codeVerifier, redirect_uri: loopback.redirectUri })
  if (!tokens.access_token || !tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Mail City from your Google account permissions and try again.')
  const info = await client.getTokenInfo(tokens.access_token)
  const profile = await fetchProfile(tokens.access_token)
  const email = info.email ?? profile?.email
  if (!email) throw new Error('Could not determine the signed-in Google account email')
  log.info('signed in', { email })
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(tokens.expiry_date ?? Date.now() + 55 * 60_000),
    email,
    displayName: profile?.name ?? email
  }
}

export async function googleRefresh(opts: { clientId: string; clientSecret: string; refreshToken: string }): Promise<{ accessToken: string; expiresAt: Date }> {
  const client = new OAuth2Client({ clientId: opts.clientId, clientSecret: opts.clientSecret || undefined })
  client.setCredentials({ refresh_token: opts.refreshToken })
  const { credentials } = await client.refreshAccessToken()
  if (!credentials.access_token) throw new Error('Google refresh returned no access token')
  return { accessToken: credentials.access_token, expiresAt: new Date(credentials.expiry_date ?? Date.now() + 55 * 60_000) }
}

async function fetchProfile(accessToken: string): Promise<{ email?: string; name?: string } | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    return (await res.json()) as { email?: string; name?: string }
  } catch {
    return null
  }
}
