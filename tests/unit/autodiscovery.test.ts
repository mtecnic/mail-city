import { describe, it, expect } from 'vitest'
import { discoverAccount } from '@kernel/accounts/autodiscovery'
import { parseAutoconfigXml, expandUsername } from '@kernel/accounts/ispdb'
import { findKnownProviderByMx } from '@kernel/accounts/providers'

const ISPDB_XML = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.net">
    <domain>example.net</domain>
    <displayName>Example Mail</displayName>
    <incomingServer type="imap">
      <hostname>imap.example.net</hostname>
      <port>143</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILLOCALPART%</username>
    </incomingServer>
    <incomingServer type="imap">
      <hostname>imap.example.net</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <incomingServer type="pop3">
      <hostname>pop.example.net</hostname><port>995</port><socketType>SSL</socketType>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.net</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

const noNet = {
  fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
  resolveMx: async () => [],
  resolveSrv: async () => [],
  probe: async () => false
}

describe('ISPDB parser', () => {
  it('prefers SSL servers and expands username templates', () => {
    const r = parseAutoconfigXml(ISPDB_XML)
    expect(r.displayName).toBe('Example Mail')
    expect(r.imap).toMatchObject({ host: 'imap.example.net', port: 993, tls: 'tls' })
    expect(r.smtp).toMatchObject({ host: 'smtp.example.net', port: 587, tls: 'starttls' })
    expect(expandUsername(r.imap?.username, 'bob@example.net')).toBe('bob@example.net')
    expect(expandUsername('%EMAILLOCALPART%', 'bob@example.net')).toBe('bob')
  })
})

describe('discoverAccount', () => {
  it('returns Gmail settings for gmail.com without network', async () => {
    const r = await discoverAccount('Someone@Gmail.com', noNet)
    expect(r.source).toBe('known')
    expect(r.type).toBe('gmail')
    expect(r.auth).toBe('oauth2')
    expect(r.imap?.host).toBe('imap.gmail.com')
    expect(r.email).toBe('someone@gmail.com')
  })

  it('detects Google Workspace from MX records', async () => {
    const r = await discoverAccount('me@customdomain.io', { ...noNet, resolveMx: async () => [{ exchange: 'aspmx.l.google.com', priority: 1 }] })
    expect(r.source).toBe('mx')
    expect(r.type).toBe('gmail')
    expect(findKnownProviderByMx(['custom-io.mail.protection.outlook.com'])?.type).toBe('outlook')
  })

  it('uses ISPDB when available', async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url)
      return u.includes('autoconfig.thunderbird.net') ? new Response(ISPDB_XML, { status: 200 }) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const r = await discoverAccount('bob@example.net', { ...noNet, fetchImpl })
    expect(r.source).toBe('ispdb')
    expect(r.imap?.port).toBe(993)
    expect(r.username).toBe('bob@example.net')
  })

  it('falls back to SRV records', async () => {
    const resolveSrv = async (name: string) =>
      name.startsWith('_imaps') ? [{ name: 'mail.srv.test', port: 993, priority: 0 }] : name.startsWith('_submission') ? [{ name: 'mail.srv.test', port: 587, priority: 0 }] : []
    const r = await discoverAccount('x@srv.test', { ...noNet, resolveSrv })
    expect(r.source).toBe('srv')
    expect(r.imap).toEqual({ host: 'mail.srv.test', port: 993, tls: 'tls' })
    expect(r.smtp).toEqual({ host: 'mail.srv.test', port: 587, tls: 'starttls' })
  })

  it('guesses and probes common host names last', async () => {
    const probe = async (c: { host: string; port: number }) => c.host === 'mail.guess.test' && (c.port === 993 || c.port === 465)
    const r = await discoverAccount('x@guess.test', { ...noNet, probe })
    expect(r.source).toBe('guess')
    expect(r.imap).toEqual({ host: 'mail.guess.test', port: 993, tls: 'tls' })
    expect(r.smtp).toEqual({ host: 'mail.guess.test', port: 465, tls: 'tls' })
  })

  it('reports none when nothing is found', async () => {
    const r = await discoverAccount('x@nowhere.test', noNet)
    expect(r.source).toBe('none')
    expect(r.imap).toBeUndefined()
  })
})
