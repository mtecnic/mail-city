import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'

function makeKernel() {
  return new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
}

describe('Kernel', () => {
  let k: Kernel | undefined
  afterEach(async () => {
    await k?.shutdown()
  })

  it('migrates an empty database and returns default settings', () => {
    k = makeKernel()
    const s = k.settings.get()
    expect(s.theme).toBe('system')
    expect(s.sync.initialWindowDays).toBe(90)
  })

  it('persists settings patches with deep merge', () => {
    k = makeKernel()
    const next = k.settings.set({ sync: { pollIntervalMinutes: 2 } })
    expect(next.sync.pollIntervalMinutes).toBe(2)
    expect(next.sync.initialWindowDays).toBe(90)
  })

  it('creates an account with an encrypted password and a default identity', () => {
    k = makeKernel()
    const acct = k.accounts.create({
      type: 'imap',
      email: 'Me@Example.com',
      displayName: 'Me',
      imap: { host: 'imap.example.com', port: 993, tls: 'tls' },
      smtp: { host: 'smtp.example.com', port: 587, tls: 'starttls' },
      auth: { type: 'password', password: 'hunter2' }
    })
    expect(acct.email).toBe('me@example.com')
    expect(k.accounts.list()).toHaveLength(1)
    expect(k.accounts.secrets.get(acct.id, 'password')?.value).toBe('hunter2')
    k.accounts.remove(acct.id)
    expect(k.accounts.list()).toHaveLength(0)
    expect(k.accounts.secrets.get(acct.id, 'password')).toBeNull()
  })

  it('has the FTS5 virtual table', () => {
    k = makeKernel()
    const row = k.dbHandle.raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'messages_fts'`).get()
    expect(row).toBeTruthy()
  })

  it('edits accounts: detail, update servers, set password, reorder', async () => {
    k = makeKernel()
    const a = k.accounts.create({ type: 'imap', email: 'a@test', displayName: 'A', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
    const b = k.accounts.create({ type: 'imap', email: 'b@test', displayName: 'B', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
    await k.updateAccount(a.id, { displayName: 'Alpha', imap: { host: 'imap.new', port: 143, tls: 'starttls' }, syncSettings: { initialWindowDays: 30 } })
    const d = k.accountDetail(a.id)
    expect(d).toMatchObject({ displayName: 'Alpha', imap: { host: 'imap.new', port: 143, tls: 'starttls' }, syncSettings: { initialWindowDays: 30 }, authType: 'password' })
    await k.setAccountPassword(a.id, 'new-secret')
    expect(k.accounts.secrets.get(a.id, 'password')?.value).toBe('new-secret')
    k.accounts.reorder([b.id, a.id])
    expect(k.accounts.list().map((x) => x.email)).toEqual(['b@test', 'a@test'])
  })
})
