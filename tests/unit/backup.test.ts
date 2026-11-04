import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher, type SecretCipher } from '@kernel/accounts/SecretStore'
import { exportBackup, importBackup } from '@kernel/backup/Backup'
import { encryptBackup, decryptBackup, readBackupHeader } from '@kernel/backup/crypto'

/** A second "machine": a different cipher, so ciphertexts are not portable. */
const otherCipher: SecretCipher = {
  encrypt: (p) => `other:${Buffer.from(p, 'utf8').toString('hex')}`,
  decrypt: (c) => Buffer.from(c.replace(/^other:/, ''), 'hex').toString('utf8'),
  isAvailable: () => true
}

function populated() {
  const k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
  const work = k.accounts.create({ type: 'gmail', email: 'Work@Example.com', displayName: 'Work', imap: { host: 'imap.gmail.com', port: 993, tls: 'tls' }, smtp: { host: 'smtp.gmail.com', port: 465, tls: 'tls' }, auth: { type: 'oauth2', provider: 'google', refreshToken: 'rt-1', accessToken: 'at-1', expiresAt: new Date(Date.now() + 3600_000) } })
  k.accounts.secrets.set(work.id, 'oauth_meta', '{"msal":"cache"}')
  const home = k.accounts.create({ type: 'imap', email: 'home@example.net', displayName: 'Home', imap: { host: 'mail.example.net', port: 143, tls: 'starttls' }, smtp: { host: 'mail.example.net', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'hunter2' } })
  const sig = k.identities.saveSignature({ name: 'Default', html: '<p>Cheers</p>', text: 'Cheers' })
  k.identities.create({ accountId: work.id, email: 'alias@example.com', name: 'Alias', signatureId: sig.id, isDefault: true })
  const rule = k.rules.save({ name: 'File receipts', conditions: { match: 'all', items: [{ field: 'subject', op: 'contains', value: 'receipt' }] }, actions: [{ type: 'markRead' }], accountIds: [work.id] })
  k.contacts.save({ name: 'Alice', emails: ['alice@example.org'], notes: 'friend' })
  k.settings.set({ theme: 'dark', sync: { initialWindowDays: 30 } })
  const prov = k.ai.upsertProvider({ kind: 'anthropic', label: 'Claude', enabled: true })
  k.ai.setApiKey(prov.id, 'sk-ant-secret')
  k.ai.set({ privacy: { mode: 'cloud-allowed', perAccount: { [work.id]: 'local-only' } } })
  k.oauthConfig.setUserConfig({ google: { clientId: 'gid', clientSecret: 'gsec' }, microsoft: { clientId: '', tenant: 'common' } })
  k.settings.setValue('savedSearches', [{ id: 'ss1', name: 'Unread', query: 'is:unread' }])
  return { k, work, home, sig, rule, prov }
}

describe('backup & restore', () => {
  const kernels: Kernel[] = []
  afterEach(async () => {
    await Promise.all(kernels.splice(0).map((k) => k.shutdown()))
  })

  it('round-trips the whole setup to a fresh installation with a different keystore', async () => {
    const src = populated()
    kernels.push(src.k)
    const { header, payload } = exportBackup(src.k, { appVersion: '1.0.0', platform: 'win32' })
    expect(header.counts).toEqual({ accounts: 2, rules: 1, contacts: 1, providers: 1 })
    expect(payload.accounts.find((a) => a.email === 'work@example.com')!.secrets).toEqual({ refresh_token: 'rt-1', oauth_meta: '{"msal":"cache"}' })
    const file = encryptBackup(header, payload, 'correct horse battery')
    expect(file).not.toContain('hunter2')
    expect(file).not.toContain('sk-ant-secret')
    expect(file).not.toContain('example.com')
    expect(readBackupHeader(file).header.counts.accounts).toBe(2)

    const dst = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: otherCipher, autoSync: false })
    kernels.push(dst)
    const result = importBackup(dst, decryptBackup(file, 'correct horse battery').payload)
    expect(result.accounts).toEqual({ created: 2, updated: 0 })
    expect(result).toMatchObject({ identities: 3, signatures: 1, rules: 1, contacts: 1, providers: 1, vaultEntries: 1 })

    // Same ids, secrets re-encrypted with the new machine's cipher.
    const work = dst.accounts.get(src.work.id)!
    expect(work).toMatchObject({ email: 'work@example.com', authType: 'oauth2', oauthProvider: 'google', imapHost: 'imap.gmail.com' })
    expect(dst.accounts.secrets.get(work.id, 'refresh_token')?.value).toBe('rt-1')
    expect(dst.accounts.secrets.get(work.id, 'oauth_meta')?.value).toBe('{"msal":"cache"}')
    expect(dst.accounts.secrets.get(work.id, 'access_token')).toBeNull()
    expect(dst.accounts.secrets.get(src.home.id, 'password')?.value).toBe('hunter2')
    expect(dst.db.select().from((await import('@kernel/db/schema')).secrets).all().every((r) => r.ciphertext.startsWith('other:'))).toBe(true)

    expect(dst.identities.defaultFor(work.id)).toMatchObject({ email: 'alias@example.com', signatureId: src.sig.id })
    expect(dst.identities.listSignatures()).toHaveLength(1)
    expect(dst.rules.list()[0]).toMatchObject({ id: src.rule.id, accountIds: [work.id] })
    expect(dst.contacts.byEmail('alice@example.org')).toMatchObject({ name: 'Alice', notes: 'friend', source: 'manual' })
    expect(dst.settings.get()).toMatchObject({ theme: 'dark', sync: { initialWindowDays: 30 } })
    const ai = dst.ai.get()
    expect(ai.providers[0]).toMatchObject({ id: src.prov.id, hasApiKey: true })
    expect(dst.vault.get(`ai.${src.prov.id}`)).toBe('sk-ant-secret')
    expect(ai.privacy).toEqual({ mode: 'cloud-allowed', perAccount: { [work.id]: 'local-only' } })
    expect(dst.oauthConfig.getUserConfig().google).toMatchObject({ clientId: 'gid', clientSecret: 'gsec' })
    expect(dst.settings.getValue('savedSearches', (await import('@shared/ipc')).SavedSearchesSchema)).toHaveLength(1)
  })

  it('merges into an existing installation by e-mail address and remaps ids', () => {
    const src = populated()
    kernels.push(src.k)
    const { header, payload } = exportBackup(src.k, { appVersion: '1.0.0', platform: 'win32' })
    const dst = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    kernels.push(dst)
    // The same mailbox already exists here under a different id and with an old password.
    const local = dst.accounts.create({ type: 'imap', email: 'home@example.net', displayName: 'Old name', imap: { host: 'old', port: 993, tls: 'tls' }, smtp: { host: 'old', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'old' } })
    const r = importBackup(dst, decryptBackup(encryptBackup(header, payload, 'passphrase1'), 'passphrase1').payload)
    expect(r.accounts).toEqual({ created: 1, updated: 1 })
    expect(dst.accounts.list()).toHaveLength(2)
    expect(dst.accounts.get(local.id)).toMatchObject({ displayName: 'Home', imapHost: 'mail.example.net' })
    expect(dst.accounts.secrets.get(local.id, 'password')?.value).toBe('hunter2')
    expect(dst.identities.list(local.id)).toHaveLength(1)
  })

  it('rejects a wrong passphrase, a tampered header and non-backup files', () => {
    const src = populated()
    kernels.push(src.k)
    const { header, payload } = exportBackup(src.k, { appVersion: '1.0.0', platform: 'linux' })
    const file = encryptBackup(header, payload, 'passphrase1')
    expect(() => decryptBackup(file, 'passphrase2')).toThrow(/Wrong passphrase/)
    const tampered = JSON.stringify({ ...JSON.parse(file), header: { ...header, counts: { ...header.counts, accounts: 99 } } })
    expect(() => decryptBackup(tampered, 'passphrase1')).toThrow(/Wrong passphrase/)
    expect(() => readBackupHeader('{"hello":1}')).toThrow(/not a Mail City backup/)
    expect(() => encryptBackup(header, payload, 'short')).toThrow(/at least 8/)
  })
})
