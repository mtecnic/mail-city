import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type { ServerConfig } from '@shared/schemas/account'
import { createLogger } from '../utils/logger'

const log = createLogger('connection-test')

export type Credentials = { user: string; pass: string } | { user: string; accessToken: string }

export interface ConnectionTestResult {
  imap: { ok: boolean; error?: string; capabilities?: string[] }
  smtp: { ok: boolean; error?: string }
}

export function imapClientOptions(server: ServerConfig, creds: Credentials, extra: Record<string, unknown> = {}) {
  return {
    host: server.host,
    port: server.port,
    secure: server.tls === 'tls',
    tls: server.tls === 'none' ? undefined : { servername: server.host },
    auth: 'pass' in creds ? { user: creds.user, pass: creds.pass } : { user: creds.user, accessToken: creds.accessToken },
    logger: false as const,
    clientInfo: { name: 'Mail City', vendor: 'mtecnic' },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    ...extra
  }
}

export function smtpTransportOptions(server: ServerConfig, creds: Credentials) {
  return {
    host: server.host,
    port: server.port,
    secure: server.tls === 'tls',
    requireTLS: server.tls === 'starttls',
    ignoreTLS: server.tls === 'none',
    auth: 'pass' in creds ? { user: creds.user, pass: creds.pass } : { type: 'OAuth2' as const, user: creds.user, accessToken: creds.accessToken },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000
  }
}

export async function testImap(server: ServerConfig, creds: Credentials): Promise<ConnectionTestResult['imap']> {
  const client = new ImapFlow(imapClientOptions(server, creds, { verifyOnly: true }))
  try {
    await client.connect()
    const caps = [...(client.capabilities?.keys?.() ?? [])].map(String)
    try {
      await client.logout()
    } catch {
      /* ignore */
    }
    return { ok: true, capabilities: caps }
  } catch (e) {
    const msg = describeImapError(e)
    log.info('IMAP test failed', { host: server.host, msg })
    return { ok: false, error: msg }
  }
}

export async function testSmtp(server: ServerConfig, creds: Credentials): Promise<ConnectionTestResult['smtp']> {
  const transport = nodemailer.createTransport(smtpTransportOptions(server, creds))
  try {
    await transport.verify()
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.info('SMTP test failed', { host: server.host, msg })
    return { ok: false, error: msg }
  } finally {
    transport.close()
  }
}

export async function testConnection(imap: ServerConfig, smtp: ServerConfig, creds: Credentials): Promise<ConnectionTestResult> {
  const [i, s] = await Promise.all([testImap(imap, creds), testSmtp(smtp, creds)])
  return { imap: i, smtp: s }
}

export function describeImapError(e: unknown): string {
  const err = e as { message?: string; responseText?: string; authenticationFailed?: boolean; code?: string; serverResponseCode?: string }
  if (err?.authenticationFailed) return `Sign-in rejected: ${err.responseText ?? err.message ?? 'authentication failed'}`
  if (err?.code === 'ENOTFOUND') return 'Server not found (check the host name)'
  if (err?.code === 'ECONNREFUSED') return 'Connection refused (check the port)'
  if (err?.code === 'ETIMEDOUT' || /timeout/i.test(err?.message ?? '')) return 'Connection timed out'
  if (/certificate|self signed|unable to verify/i.test(err?.message ?? '')) return `TLS certificate problem: ${err.message}`
  return err?.responseText ?? err?.message ?? String(e)
}
