import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import { AccountSyncer } from '@kernel/sync/AccountSyncer'
import { FakeImapProvider } from './fakeImap'

function setup() {
  const k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
  const acct = k.accounts.create({ type: 'imap', email: 'me@test', displayName: 'Me', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
  const fake = new FakeImapProvider(acct.id)
  const inbox = fake.box('INBOX')
  inbox.add({ subject: 'Old', from: 'a@x', date: new Date(Date.now() - 400 * 86_400_000) })
  inbox.add({ subject: 'Hello', from: 'b@x', date: new Date(Date.now() - 3600_000), body: 'hi there' })
  inbox.add({ subject: 'Re: Hello', from: 'c@x', date: new Date(), flags: ['\\Seen'] })
  const events: string[] = []
  const syncer = new AccountSyncer(k.accounts.get(acct.id)!, {
    store: k.store,
    ops: k.sync.ops,
    getCredentials: async () => ({ user: 'u', pass: 'p' }),
    dataDir: '/tmp/mail-city-test',
    settings: () => ({ initialWindowDays: 90, pollIntervalMinutes: 5 }),
    onAccountError: () => {},
    createProvider: () => fake
  })
  syncer.on('newMessages', (_f, ids) => events.push(`new:${ids.length}`))
  syncer.on('headersStored', (_f, ids) => events.push(`stored:${ids.length}`))
  syncer['fullResyncRequested'] = true
  return { k, acct, fake, inbox, syncer, events }
}

describe('AccountSyncer with a fake IMAP server', () => {
  let k: Kernel
  afterEach(async () => k?.shutdown())

  it('does an initial sync within the window, then incremental new/flag/delete sync', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    const folders = k.store.listFolders(s.acct.id)
    expect(folders.map((f) => f.path).sort()).toEqual(['Archive', 'INBOX', 'Sent', 'Trash'])
    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    // "Old" is outside the 90-day window.
    expect(k.store.list({ folderId: inboxF.id }).map((m) => m.subject)).toEqual(['Re: Hello', 'Hello'])
    expect(s.events).toEqual(['stored:2'])
    expect(k.store.getFolder(inboxF.id)!.unreadCount).toBe(1)
    // Threading via subject fallback.
    const items = k.store.list({ folderId: inboxF.id })
    expect(items[0]!.threadId).toBe(items[1]!.threadId)

    // Server-side changes: new message, flag change, deletion.
    s.inbox.add({ subject: 'Fresh', from: 'd@x', date: new Date() })
    s.inbox.messages.get(2)!.flags.add('\\Seen')
    s.inbox.messages.delete(3)
    s.syncer.requestFolderSync(inboxF.id)
    await s.syncer.tick()
    const after = k.store.list({ folderId: inboxF.id })
    expect(after.map((m) => m.subject)).toEqual(['Fresh', 'Hello'])
    expect(after[1]!.flags.seen).toBe(true)
    expect(s.events).toContain('new:1')
  })

  it('replays queued operations and resolves placeholder uids after a move', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    const hello = k.store.list({ folderId: inboxF.id }).find((m) => m.subject === 'Hello')!
    // Optimistic local actions.
    k.mail.markRead([hello.id])
    k.mail.archive([hello.id])
    const archiveF = k.store.folderBySpecialUse(s.acct.id, 'archive')!
    expect(k.store.getMessage(hello.id)!.folderId).toBe(archiveF.id)
    expect(k.store.getMessage(hello.id)!.uid).toBeLessThan(0)
    expect(k.sync.ops.pendingCount(s.acct.id)).toBe(2)

    await s.syncer.tick()
    expect(k.sync.ops.pendingCount(s.acct.id)).toBe(0)
    expect(s.fake.ops).toEqual(['addFlags 2 \\Seen', 'move 2 -> Archive'])
    expect(s.fake.box('Archive').messages.size).toBe(1)
    // Real uid assigned from the server's COPYUID map, and folder syncs ran.
    const moved = k.store.getMessage(hello.id)!
    expect(moved.folderId).toBe(archiveF.id)
    expect(moved.uid).toBeGreaterThan(0)
    expect(k.store.list({ folderId: inboxF.id }).map((m) => m.subject)).toEqual(['Re: Hello'])
  })

  it('fetches bodies on demand and persists them', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    const hello = k.store.list({ folderId: inboxF.id }).find((m) => m.subject === 'Hello')!
    const p = s.syncer.fetchBody(hello.id)
    await s.syncer.tick()
    expect(await p).toBe(true)
    const d = await k.mail.get(hello.id, { fetchBody: false })
    expect(d.bodyState).toBe('full')
    expect(d.textPlain?.trim()).toBe('hi there')
    expect(k.search.search('"hi there"').map((m) => m.id)).toEqual([hello.id])
  })

  it('wipes the folder cache when UIDVALIDITY changes', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    s.inbox.uidValidity = 2n
    s.syncer.requestFolderSync(inboxF.id)
    await s.syncer.tick()
    expect(k.store.getFolder(inboxF.id)!.uidValidity).toBe(2)
    expect(k.store.list({ folderId: inboxF.id })).toHaveLength(2)
  })
})
