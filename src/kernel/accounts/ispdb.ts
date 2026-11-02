/**
 * Parser for Mozilla ISPDB / Thunderbird autoconfig XML (config-v1.1).
 * We only need host/port/socketType/authentication, so a small tolerant
 * regex-based parser is enough and avoids pulling in an XML library.
 */
import type { ServerConfig } from '@shared/schemas/account'

export interface AutoconfigResult {
  displayName?: string
  imap?: ServerConfig & { username?: string; oauth2?: boolean }
  smtp?: ServerConfig & { username?: string; oauth2?: boolean }
}

function text(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'))
  return m?.[1]?.trim()
}

function allText(block: string, tag: string): string[] {
  return [...block.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi'))].map((m) => m[1]!.trim())
}

function toTls(socketType: string | undefined): ServerConfig['tls'] {
  switch ((socketType ?? '').toUpperCase()) {
    case 'SSL':
      return 'tls'
    case 'STARTTLS':
      return 'starttls'
    default:
      return 'none'
  }
}

function parseServer(block: string): (ServerConfig & { username?: string; oauth2?: boolean }) | undefined {
  const host = text(block, 'hostname')
  const port = Number(text(block, 'port'))
  if (!host || !Number.isFinite(port)) return undefined
  const auths = allText(block, 'authentication').map((a) => a.toLowerCase())
  return {
    host,
    port,
    tls: toTls(text(block, 'socketType')),
    username: text(block, 'username'),
    oauth2: auths.includes('oauth2')
  }
}

export function parseAutoconfigXml(xml: string): AutoconfigResult {
  const result: AutoconfigResult = {}
  result.displayName = text(xml, 'displayName')

  // Prefer SSL/TLS servers over STARTTLS over plain; the XML lists them in preference order anyway.
  const incoming = [...xml.matchAll(/<incomingServer\s+type="imap"[^>]*>([\s\S]*?)<\/incomingServer>/gi)].map((m) => m[1]!)
  const outgoing = [...xml.matchAll(/<outgoingServer\s+type="smtp"[^>]*>([\s\S]*?)<\/outgoingServer>/gi)].map((m) => m[1]!)

  const rank = (s: ServerConfig) => (s.tls === 'tls' ? 0 : s.tls === 'starttls' ? 1 : 2)
  const pick = (blocks: string[]) =>
    blocks
      .map(parseServer)
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => rank(a) - rank(b))[0]

  result.imap = pick(incoming)
  result.smtp = pick(outgoing)
  return result
}

/** Resolve `%EMAILADDRESS%` / `%EMAILLOCALPART%` / `%EMAILDOMAIN%` placeholders in usernames. */
export function expandUsername(template: string | undefined, email: string): string {
  if (!template) return email
  const [local = '', domain = ''] = email.split('@')
  return template.replace(/%EMAILADDRESS%/gi, email).replace(/%EMAILLOCALPART%/gi, local).replace(/%EMAILDOMAIN%/gi, domain)
}
