import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import type { HeaderRecord } from '@kernel/providers/ImapProvider'
import { normalizeSubject } from '@kernel/mail/threading'

function header(uid: number, over: Partial<HeaderRecord> & { envelope?: Partial<HeaderRecord['envelope']> } = {}): HeaderRecord {
  return {
    uid,
    modseq: undefined,
    flags: new Set(),
    labels: undefined,
    threadId: undefined,
    size: 1000,
    internalDate: new Date('2026-01-01T00:00:00Z'),
    bodyStructure: undefined,
    headers: {},
    ...over,
    envelope: {
      date: new Date('2026-01-01T00:00:00Z'),
      subject: 'Hello',
      messageId: `<m${uid}@test>`,
      from: [{ name: 'Alice', address: 'alice@test' }],
      to: [{ name: '', address: 'me@test' }],
      ...over.envelope
    }
  }
}

describe('MessageStore', () => {
  let k: Kernel
  let accountId: string
  let inboxId: string
  beforeEach(() => {
    k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    accountId = k.accounts.create({
      type: 'imap',
      email: 'me@test',
      displayName: 'Me',
      imap: { host: 'x', port: 993, tls: 'tls' },
      smtp: { host: 'x', port: 587, tls: 'starttls' },
      auth: { type: 'password', password: 'p' }
    }).id
    inboxId = k.store.upsertFolder({ id: 'fld_inbox', accountId, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 }).id
  })
  afterEach(async () => k.shutdown())

  it('normalizes subjects', () => {
    expect(normalizeSubject('Re: RE: Fwd: [list] Hello  world')).toBe('hello world')
    expect(normalizeSubject('AW: Re[2]: Test')).toBe('test')
  })

  it('upserts headers, threads replies and lists newest first', () => {
    const a = k.store.upsertHeader(accountId, inboxId, header(1))
    const b = k.store.upsertHeader(accountId, inboxId, header(2, { envelope: { subject: 'Re: Hello', inReplyTo: '<m1@test>', date: new Date('2026-01-02T00:00:00Z') } }))
    const c = k.store.upsertHeader(accountId, inboxId, header(3, { envelope: { subject: 'Other', date: new Date('2026-01-03T00:00:00Z') } }))
    expect(a.isNew && b.isNew && c.isNew).toBe(true)
    const ma = k.store.getMessage(a.id)!
    const mb = k.store.getMessage(b.id)!
    expect(mb.threadId).toBe(ma.threadId)
    expect(k.store.getMessage(c.id)!.threadId).not.toBe(ma.threadId)

    const list = k.store.list({ folderId: inboxId })
    expect(list.map((m) => m.uid)).toEqual([3, 2, 1])
    expect(list[1]!.threadCount).toBe(2)
    expect(list[1]!.threadUnread).toBe(2)

    // Re-upserting the same UID only updates flags.
    const again = k.store.upsertHeader(accountId, inboxId, header(1, { flags: new Set(['\\Seen']) }))
    expect(again.isNew).toBe(false)
    expect(k.store.getMessage(a.id)!.flags.seen).toBe(true)
  })

  it('unified inbox query spans accounts and respects unread filter', () => {
    k.store.upsertHeader(accountId, inboxId, header(1))
    k.store.upsertHeader(accountId, inboxId, header(2, { flags: new Set(['\\Seen']) }))
    expect(k.store.list({ specialUse: 'inbox' })).toHaveLength(2)
    expect(k.store.list({ specialUse: 'inbox', unreadOnly: true })).toHaveLength(1)
    k.store.refreshFolderCounts(inboxId)
    expect(k.store.getFolder(inboxId)!.unreadCount).toBe(1)
    expect(k.store.unreadTotal()).toBe(1)
  })

  it('local flag/move/delete go through MessageService and queue ops', () => {
    const trash = k.store.upsertFolder({ id: 'fld_trash', accountId, path: 'Trash', name: 'Trash', delimiter: '/', specialUse: 'trash', subscribed: true, sortOrder: 1 })
    const { id } = k.store.upsertHeader(accountId, inboxId, header(5))
    k.mail.markRead([id])
    expect(k.store.getMessage(id)!.flags.seen).toBe(true)
    k.mail.delete([id])
    expect(k.store.getMessage(id)!.folderId).toBe(trash.id)
    expect(k.store.getMessage(id)!.uid).toBeLessThan(0)
    expect(k.sync.ops.pendingCount(accountId)).toBe(2)
    expect(k.sync.ops.next(accountId)!.kind).toBe('setFlags')
  })

  it('shows each email once in a conversation when Gmail stores it in several folders', () => {
    const allMail = k.store.upsertFolder({ id: 'fld_all', accountId, path: '[Gmail]/All Mail', name: 'All Mail', delimiter: '/', specialUse: 'all', subscribed: true, sortOrder: 5 }).id
    const sent = k.store.upsertFolder({ id: 'fld_sent', accountId, path: '[Gmail]/Sent Mail', name: 'Sent Mail', delimiter: '/', specialUse: 'sent', subscribed: true, sortOrder: 2 }).id
    const gm = { threadId: '777' }
    // The original: in INBOX and All Mail. The reply: in Sent and All Mail.
    const aInbox = k.store.upsertHeader(accountId, inboxId, header(1, { ...gm, envelope: { messageId: '<a@x>' } }))
    const aAll = k.store.upsertHeader(accountId, allMail, header(50, { ...gm, envelope: { messageId: '<a@x>' } }))
    const bSent = k.store.upsertHeader(accountId, sent, header(3, { ...gm, flags: new Set(['\\Seen']), envelope: { messageId: '<b@x>', subject: 'Re: Hello', date: new Date('2026-01-02T00:00:00Z') } }))
    k.store.upsertHeader(accountId, allMail, header(51, { ...gm, flags: new Set(['\\Seen']), envelope: { messageId: '<b@x>', subject: 'Re: Hello', date: new Date('2026-01-02T00:00:00Z') } }))

    expect(k.mail.thread('gm:777').map((m) => m.id)).toEqual([aInbox.id, bSent.id])
    // The copy the user opened always wins its group.
    expect(k.mail.thread('gm:777', aAll.id).map((m) => m.id)).toEqual([aAll.id, bSent.id])
    // Counts are emails, not stored copies.
    const row = k.store.list({ folderId: inboxId })[0]!
    expect(row.threadCount).toBe(2)
    expect(row.threadUnread).toBe(1)
  })

  it('archiving into a folder that already holds the copy replaces it instead of colliding', () => {
    const allMail = k.store.upsertFolder({ id: 'fld_all', accountId, path: '[Gmail]/All Mail', name: 'All Mail', delimiter: '/', specialUse: 'all', subscribed: true, sortOrder: 5 }).id
    const moved = k.store.upsertHeader(accountId, inboxId, header(9, { envelope: { messageId: '<c@x>' } }))
    k.store.upsertHeader(accountId, allMail, header(60, { envelope: { messageId: '<c@x>' } }))
    expect(() => k.store.moveLocal(moved.id, allMail, 60)).not.toThrow()
    const copies = k.store.list({ folderId: allMail })
    expect(copies.map((m) => m.id)).toEqual([moved.id])
    expect(k.store.getMessage(moved.id)!.uid).toBe(60)
  })
})
