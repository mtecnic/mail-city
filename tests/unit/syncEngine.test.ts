import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import { AccountSyncer } from '@kernel/sync/AccountSyncer'
import { FakeImapProvider, FakeMailbox } from './fakeImap'

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

  it('creates, renames, deletes folders and marks all read / empties trash through the op queue', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    k.folders.create(s.acct.id, 'Receipts')
    await s.syncer.tick()
    const receipts = k.store.folderByPath(s.acct.id, 'Receipts')!
    expect(receipts).toBeTruthy()
    k.folders.rename(receipts.id, 'Invoices')
    await s.syncer.tick()
    expect(k.store.folderByPath(s.acct.id, 'Invoices')).toBeTruthy()
    expect(k.store.folderByPath(s.acct.id, 'Receipts')).toBeUndefined()
    expect(() => k.folders.delete(k.store.folderBySpecialUse(s.acct.id, 'inbox')!.id)).toThrow(/System folders/)
    k.folders.delete(k.store.folderByPath(s.acct.id, 'Invoices')!.id)
    await s.syncer.tick()
    expect(s.fake.mailboxes.has('Invoices')).toBe(false)

    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    expect(k.folders.markAllRead(inboxF.id)).toBe(1)
    expect(k.store.getFolder(inboxF.id)!.unreadCount).toBe(0)
    await s.syncer.tick()
    expect(s.fake.ops).toContain('addFlags 2 \\Seen')

    const trash = k.store.folderBySpecialUse(s.acct.id, 'trash')!
    const hello = k.store.list({ folderId: inboxF.id }).find((m) => m.subject === 'Hello')!
    k.mail.delete([hello.id])
    await s.syncer.tick()
    expect(k.store.list({ folderId: trash.id })).toHaveLength(1)
    expect(k.folders.empty(trash.id)).toBe(1)
    await s.syncer.tick()
    expect(s.fake.box('Trash').messages.size).toBe(0)
    expect(() => k.folders.empty(inboxF.id)).toThrow(/Only Trash/)
  })

  it('fetches raw message source on demand', async () => {
    const s = setup()
    k = s.k
    await s.syncer.tick()
    const inboxF = k.store.folderBySpecialUse(s.acct.id, 'inbox')!
    const hello = k.store.list({ folderId: inboxF.id }).find((m) => m.subject === 'Hello')!
    const p = s.syncer.fetchSource(hello.id)
    await s.syncer.tick()
    expect((await p)?.toString()).toMatch(/^From: b@x/m)
  })

  it('records the server UID of an appended draft so the next save replaces the old copy', async () => {
    const s = setup()
    k = s.k
    s.fake.mailboxes.set('Drafts', new FakeMailbox('Drafts', '\\Drafts'))
    // Forward the standalone syncer's events the way SyncEngine does for managed syncers.
    s.syncer.on('appended', (folderId, uid, op) => k.sync.emit('appended', s.acct.id, folderId, uid, op))
    await s.syncer.tick()
    const draft = k.drafts.save({ accountId: s.acct.id, identityId: k.identities.defaultFor(s.acct.id)!.id, to: [{ name: '', address: 'x@y' }], cc: [], bcc: [], subject: 'WIP', html: '<p>hi</p>', text: 'hi', inReplyToMessageId: null, replyMode: null })
    await k.compose.syncDraftToServer(draft.id)
    await s.syncer.tick()
    const first = k.drafts.getRow(draft.id)!
    expect(first.serverUid).toBe(1)
    expect(s.fake.box('Drafts').messages.size).toBe(1)
    // Save again: the previous server copy is deleted, the new one appended and tracked.
    await k.compose.syncDraftToServer(draft.id)
    await s.syncer.tick()
    expect(s.fake.ops.filter((o) => o.startsWith('delete') || o.startsWith('append'))).toEqual(['append Drafts', 'delete 1', 'append Drafts'])
    expect(s.fake.box('Drafts').messages.size).toBe(1)
    expect(k.drafts.getRow(draft.id)!.serverUid).toBe(2)
    // Discarding removes the server copy too.
    k.compose.discardDraft(draft.id)
    await s.syncer.tick()
    expect(s.fake.box('Drafts').messages.size).toBe(0)
  })
})
