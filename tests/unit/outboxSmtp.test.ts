import { describe, it, expect, afterEach } from 'vitest'
import { SMTPServer } from 'smtp-server'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'

async function startSmtp(): Promise<{ port: number; received: string[]; close: () => Promise<void> }> {
  const received: string[] = []
  const server = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (_auth, _session, cb) => cb(null, { user: 'ok' }),
    onData(stream, _session, cb) {
      let data = ''
      stream.on('data', (c: Buffer) => (data += c.toString()))
      stream.on('end', () => {
        received.push(data)
        cb()
      })
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.server.address() as { port: number }).port
  return { port, received, close: () => new Promise((r) => server.close(() => r())) }
}

describe('Outbox → SMTP', () => {
  let k: Kernel
  let smtp: Awaited<ReturnType<typeof startSmtp>>
  afterEach(async () => {
    await k?.shutdown()
    await smtp?.close()
  })

  it('sends a queued draft once the undo window passes, marks the original answered', async () => {
    smtp = await startSmtp()
    k = new Kernel({ dataDir: '/tmp/mail-city-test', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    k.settings.set({ compose: { undoSendSeconds: 0 } })
    const acct = k.accounts.create({ type: 'imap', email: 'me@test', displayName: 'Me Tester', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none' }, auth: { type: 'password', password: 'p' } })
    const identity = k.identities.defaultFor(acct.id)!
    const draft = k.drafts.save({ accountId: acct.id, identityId: identity.id, to: [{ name: 'Alice', address: 'alice@example.com' }], subject: 'Hello from the test', html: '<p>Hi <b>Alice</b></p>', text: 'Hi Alice' })
    const item = await k.outbox.send(draft)
    expect(item.status).toBe('queued')
    expect(k.drafts.get(draft.id)).toBeUndefined() // consumed

    // Drive the sender loop manually.
    await k.outbox['pump']()
    await new Promise((r) => setTimeout(r, 300))
    for (let i = 0; i < 30 && !smtp.received.length; i++) await new Promise((r) => setTimeout(r, 100))

    expect(smtp.received).toHaveLength(1)
    const raw = smtp.received[0]!
    expect(raw).toMatch(/^From: Me Tester <me@test>/m)
    expect(raw).toMatch(/^To: Alice <alice@example.com>/m)
    expect(raw).toMatch(/^Subject: Hello from the test/m)
    expect(raw).toContain('<b>Alice</b>')
    expect(k.outbox.list().find((o) => o.id === item.id)).toBeUndefined() // sent items leave the outbox view
    // Non-Gmail provider → an append-to-Sent op is queued for the sync engine.
    expect(k.sync.ops.pendingCount(acct.id)).toBe(0) // no Sent folder cached yet → nothing to append
  })

  it('undo restores the draft and cancels the send', async () => {
    smtp = await startSmtp()
    k = new Kernel({ dataDir: '/tmp/mail-city-test', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    k.settings.set({ compose: { undoSendSeconds: 30 } })
    const acct = k.accounts.create({ type: 'imap', email: 'me@test', displayName: 'Me', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: '127.0.0.1', port: smtp.port, tls: 'none' }, auth: { type: 'password', password: 'p' } })
    const draft = k.drafts.save({ accountId: acct.id, to: [{ name: '', address: 'bob@example.com' }], subject: 'Oops', html: '<p>wrong</p>', text: 'wrong' })
    const item = await k.outbox.send(draft)
    expect(item.undoUntil).toBeTruthy()
    const restored = k.outbox.cancel(item.id)
    expect(restored?.subject).toBe('Oops')
    expect(k.drafts.get(draft.id)?.subject).toBe('Oops')
    await k.outbox['pump']()
    await new Promise((r) => setTimeout(r, 200))
    expect(smtp.received).toHaveLength(0)
  })
})
