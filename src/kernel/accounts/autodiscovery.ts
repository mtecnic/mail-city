import { promises as dns } from 'node:dns'
import { connect as tlsConnect } from 'node:tls'
import { connect as netConnect } from 'node:net'
import type { AccountType, ServerConfig } from '@shared/schemas/account'
import { findKnownProviderByDomain, findKnownProviderByMx, type KnownProvider } from './providers'
import { parseAutoconfigXml, expandUsername } from './ispdb'
import { createLogger } from '../utils/logger'

const log = createLogger('autodiscovery')

export interface DiscoveryResult {
  email: string
  domain: string
  type: AccountType
  providerLabel: string
  source: 'known' | 'mx' | 'ispdb' | 'autoconfig' | 'srv' | 'guess' | 'none'
  imap?: ServerConfig
  smtp?: ServerConfig
  username: string
  /** Recommended auth. OAuth is only offered for providers we have a flow for. */
  auth: 'oauth2' | 'password'
  oauthProvider?: 'google' | 'microsoft'
  passwordHint?: string
  helpUrl?: string
}

export interface DiscoveryOptions {
  /** Abort signal for the whole discovery. */
  signal?: AbortSignal
  /** Per-step network timeout. */
  timeoutMs?: number
  /** Dependency injection for tests. */
  fetchImpl?: typeof fetch
  resolveMx?: (domain: string) => Promise<{ exchange: string; priority: number }[]>
  resolveSrv?: (name: string) => Promise<{ name: string; port: number; priority: number }[]>
  probe?: (cfg: ServerConfig) => Promise<boolean>
}

function fromKnown(p: KnownProvider, email: string, source: DiscoveryResult['source']): DiscoveryResult {
  return {
    email,
    domain: email.split('@')[1] ?? '',
    type: p.type,
    providerLabel: p.label,
    source,
    imap: p.imap,
    smtp: p.smtp,
    username: email,
    auth: p.auth,
    oauthProvider: p.oauthProvider,
    passwordHint: p.passwordHint,
    helpUrl: p.helpUrl
  }
}

export async function discoverAccount(emailRaw: string, opts: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const email = emailRaw.trim().toLowerCase()
  const domain = email.split('@')[1]
  if (!domain) throw new Error('Enter a full email address')
  const timeoutMs = opts.timeoutMs ?? 6000
  const fetchImpl = opts.fetchImpl ?? fetch
  const resolveMx = opts.resolveMx ?? ((d: string) => dns.resolveMx(d))
  const resolveSrv = opts.resolveSrv ?? ((n: string) => dns.resolveSrv(n))
  const probe = opts.probe ?? ((cfg: ServerConfig) => probeServer(cfg, Math.min(timeoutMs, 4000)))

  // 1. Known provider by domain.
  const known = findKnownProviderByDomain(domain)
  if (known) return fromKnown(known, email, 'known')

  // 2. Known provider by MX (Google Workspace / Microsoft 365 / iCloud custom domains).
  let mxHosts: string[] = []
  try {
    const mx = await withTimeout(resolveMx(domain), timeoutMs, opts.signal)
    mxHosts = mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange)
    const byMx = findKnownProviderByMx(mxHosts)
    if (byMx) return fromKnown(byMx, email, 'mx')
  } catch (e) {
    log.debug('MX lookup failed', { domain, error: String(e) })
  }

  // 3. Mozilla ISPDB.
  const ispdb = await tryAutoconfig(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, email, fetchImpl, timeoutMs, opts.signal)
  if (ispdb) return { ...ispdb, source: 'ispdb' }

  // 4. Domain-hosted autoconfig.
  for (const url of [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`
  ]) {
    const r = await tryAutoconfig(url, email, fetchImpl, timeoutMs, opts.signal)
    if (r) return { ...r, source: 'autoconfig' }
  }

  // 5. DNS SRV (RFC 6186).
  try {
    const [imaps, imap, submission] = await Promise.all([
      resolveSrv(`_imaps._tcp.${domain}`).catch(() => []),
      resolveSrv(`_imap._tcp.${domain}`).catch(() => []),
      resolveSrv(`_submission._tcp.${domain}`).catch(() => [])
    ])
    const best = (list: { name: string; port: number; priority: number }[]) => list.filter((s) => s.name && s.name !== '.').sort((a, b) => a.priority - b.priority)[0]
    const i = best(imaps) ? { ...best(imaps)!, tls: 'tls' as const } : best(imap) ? { ...best(imap)!, tls: 'starttls' as const } : undefined
    const s = best(submission)
    if (i && s) {
      return {
        email,
        domain,
        type: 'imap',
        providerLabel: domain,
        source: 'srv',
        imap: { host: i.name, port: i.port, tls: i.tls },
        smtp: { host: s.name, port: s.port, tls: s.port === 465 ? 'tls' : 'starttls' },
        username: email,
        auth: 'password'
      }
    }
  } catch (e) {
    log.debug('SRV lookup failed', { domain, error: String(e) })
  }

  // 6. Guess common hostnames and probe them.
  const imapCandidates: ServerConfig[] = []
  const smtpCandidates: ServerConfig[] = []
  const hostBases = [`imap.${domain}`, `mail.${domain}`, domain, ...mxHosts.slice(0, 1)]
  for (const h of hostBases) {
    imapCandidates.push({ host: h, port: 993, tls: 'tls' }, { host: h, port: 143, tls: 'starttls' })
  }
  for (const h of [`smtp.${domain}`, `mail.${domain}`, domain, ...mxHosts.slice(0, 1)]) {
    smtpCandidates.push({ host: h, port: 465, tls: 'tls' }, { host: h, port: 587, tls: 'starttls' })
  }
  const [imapHit, smtpHit] = await Promise.all([firstReachable(imapCandidates, probe), firstReachable(smtpCandidates, probe)])
  if (imapHit) {
    return {
      email,
      domain,
      type: 'imap',
      providerLabel: domain,
      source: 'guess',
      imap: imapHit,
      smtp: smtpHit ?? { host: imapHit.host.replace(/^imap\./, 'smtp.'), port: 587, tls: 'starttls' },
      username: email,
      auth: 'password'
    }
  }

  return { email, domain, type: 'imap', providerLabel: domain, source: 'none', username: email, auth: 'password' }
}

async function tryAutoconfig(url: string, email: string, fetchImpl: typeof fetch, timeoutMs: number, signal?: AbortSignal): Promise<DiscoveryResult | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow' })
    clearTimeout(t)
    if (!res.ok) return null
    const xml = await res.text()
    if (!/<clientConfig/i.test(xml)) return null
    const parsed = parseAutoconfigXml(xml)
    if (!parsed.imap) return null
    const domain = email.split('@')[1] ?? ''
    return {
      email,
      domain,
      type: 'imap',
      providerLabel: parsed.displayName ?? domain,
      source: 'autoconfig',
      imap: { host: parsed.imap.host, port: parsed.imap.port, tls: parsed.imap.tls },
      smtp: parsed.smtp ? { host: parsed.smtp.host, port: parsed.smtp.port, tls: parsed.smtp.tls } : undefined,
      username: expandUsername(parsed.imap.username, email),
      auth: 'password'
    }
  } catch (e) {
    log.debug('autoconfig fetch failed', { url, error: String(e) })
    return null
  }
}

async function firstReachable(candidates: ServerConfig[], probe: (c: ServerConfig) => Promise<boolean>): Promise<ServerConfig | undefined> {
  // Probe in parallel but return the highest-ranked hit to keep results deterministic.
  const results = await Promise.all(candidates.map((c) => probe(c).catch(() => false)))
  const idx = results.findIndex(Boolean)
  return idx >= 0 ? candidates[idx] : undefined
}

/** TCP/TLS reachability probe: connects and waits for the server greeting. */
export function probeServer(cfg: ServerConfig, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    const socket =
      cfg.tls === 'tls'
        ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: true })
        : netConnect({ host: cfg.host, port: cfg.port })
    socket.once('data', (d: Buffer) => finish(/^(\* OK|220)/.test(d.toString('utf8'))))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    p.then((v) => {
      clearTimeout(t)
      resolve(v)
    }, (e) => {
      clearTimeout(t)
      reject(e)
    })
  })
}
