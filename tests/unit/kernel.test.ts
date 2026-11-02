import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'

function makeKernel() {
  return new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher })
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
})
