import type { AccountType, ServerConfig } from '@shared/schemas/account'

export interface KnownProvider {
  type: AccountType
  label: string
  domains: string[]
  /** Also match MX hosts ending with any of these (for Workspace / M365 custom domains). */
  mxSuffixes?: string[]
  imap: ServerConfig
  smtp: ServerConfig
  auth: 'oauth2' | 'password'
  oauthProvider?: 'google' | 'microsoft'
  /** Shown in the wizard when a password is required. */
  passwordHint?: string
  helpUrl?: string
}

export const KNOWN_PROVIDERS: KnownProvider[] = [
  {
    type: 'gmail',
    label: 'Google (Gmail / Workspace)',
    domains: ['gmail.com', 'googlemail.com'],
    mxSuffixes: ['google.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, tls: 'tls' },
    auth: 'oauth2',
    oauthProvider: 'google',
    passwordHint: 'Google requires an App Password (Google Account → Security → 2-Step Verification → App passwords) if you do not sign in with OAuth.',
    helpUrl: 'https://support.google.com/mail/answer/185833'
  },
  {
    type: 'outlook',
    label: 'Microsoft (Outlook.com / Microsoft 365)',
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'outlook.de', 'hotmail.co.uk', 'live.co.uk', 'hotmail.fr', 'outlook.fr'],
    mxSuffixes: ['outlook.com', 'mail.protection.outlook.com'],
    imap: { host: 'outlook.office365.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.office365.com', port: 587, tls: 'starttls' },
    auth: 'oauth2',
    oauthProvider: 'microsoft',
    passwordHint: 'Microsoft accounts require OAuth sign-in. Basic authentication (password) is disabled for Outlook.com and Microsoft 365.'
  },
  {
    type: 'icloud',
    label: 'iCloud Mail',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    mxSuffixes: ['icloud.com'],
    imap: { host: 'imap.mail.me.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.mail.me.com', port: 587, tls: 'starttls' },
    auth: 'password',
    passwordHint: 'iCloud requires an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords).',
    helpUrl: 'https://support.apple.com/en-us/102654'
  },
  {
    type: 'yahoo',
    label: 'Yahoo Mail',
    domains: ['yahoo.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.de', 'yahoo.fr', 'ymail.com', 'rocketmail.com', 'aol.com'],
    mxSuffixes: ['yahoodns.net'],
    imap: { host: 'imap.mail.yahoo.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, tls: 'tls' },
    auth: 'password',
    passwordHint: 'Yahoo requires an app password (Yahoo Account Security → Generate app password).',
    helpUrl: 'https://help.yahoo.com/kb/SLN15241.html'
  },
  {
    type: 'imap',
    label: 'Fastmail',
    domains: ['fastmail.com', 'fastmail.fm', 'fastmail.us', 'sent.com', 'messagingengine.com'],
    mxSuffixes: ['messagingengine.com'],
    imap: { host: 'imap.fastmail.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.fastmail.com', port: 465, tls: 'tls' },
    auth: 'password',
    passwordHint: 'Fastmail requires an app password (Settings → Privacy & Security → Integrations → New app password).'
  },
  {
    type: 'imap',
    label: 'Zoho Mail',
    domains: ['zoho.com', 'zohomail.com', 'zoho.eu', 'zohomail.eu'],
    mxSuffixes: ['zoho.com', 'zoho.eu'],
    imap: { host: 'imap.zoho.com', port: 993, tls: 'tls' },
    smtp: { host: 'smtp.zoho.com', port: 465, tls: 'tls' },
    auth: 'password',
    passwordHint: 'Zoho requires an application-specific password if 2FA is enabled, and IMAP access must be enabled in Zoho Mail settings.'
  },
  {
    type: 'imap',
    label: 'Proton Mail (via Proton Mail Bridge)',
    domains: ['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'],
    imap: { host: '127.0.0.1', port: 1143, tls: 'starttls' },
    smtp: { host: '127.0.0.1', port: 1025, tls: 'starttls' },
    auth: 'password',
    passwordHint: 'Proton Mail needs Proton Mail Bridge running on this PC. Use the Bridge-generated password, not your Proton password.',
    helpUrl: 'https://proton.me/mail/bridge'
  },
  {
    type: 'imap',
    label: 'GMX',
    domains: ['gmx.com', 'gmx.net', 'gmx.de', 'gmx.at', 'gmx.ch'],
    imap: { host: 'imap.gmx.net', port: 993, tls: 'tls' },
    smtp: { host: 'mail.gmx.net', port: 465, tls: 'tls' },
    auth: 'password'
  }
]

export function findKnownProviderByDomain(domain: string): KnownProvider | undefined {
  const d = domain.toLowerCase()
  return KNOWN_PROVIDERS.find((p) => p.domains.includes(d))
}

export function findKnownProviderByMx(mxHosts: string[]): KnownProvider | undefined {
  const hosts = mxHosts.map((h) => h.toLowerCase().replace(/\.$/, ''))
  return KNOWN_PROVIDERS.find((p) => p.mxSuffixes?.some((s) => hosts.some((h) => h === s || h.endsWith('.' + s))))
}
