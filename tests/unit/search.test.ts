import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import type { HeaderRecord } from '@kernel/providers/ImapProvider'

function header(uid: number, subject: string, from: string, date: string, extra: Partial<HeaderRecord> = {}): HeaderRecord {
  return { uid, modseq: undefined, flags: new Set(), labels: undefined, threadId: undefined, size: 100, internalDate: new Date(date), bodyStructure: undefined, headers: {}, envelope: { subject, messageId: `<${uid}@t>`, from: [{ name: from.split('@')[0], address: from }], to: [{ address: 'me@test' }], date: new Date(date) }, ...extra }
}

describe('SearchService (FTS5)', () => {
  let k: Kernel
  afterEach(async () => k?.shutdown())

  it('finds by text, operators and body after fetch; excludes trash by default', () => {
    k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    const acct = k.accounts.create({ type: 'imap', email: 'me@test', displayName: 'Me', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
    const inbox = k.store.upsertFolder({ id: 'f1', accountId: acct.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
    const trash = k.store.upsertFolder({ id: 'f2', accountId: acct.id, path: 'Trash', name: 'Trash', delimiter: '/', specialUse: 'trash', subscribed: true, sortOrder: 1 })
    const a = k.store.upsertHeader(acct.id, inbox.id, header(1, 'Invoice 42 from Acme', 'billing@acme.test', '2026-02-01T10:00:00Z'))
    k.store.upsertHeader(acct.id, inbox.id, header(2, 'Lunch on Friday?', 'bob@friends.test', '2026-02-02T10:00:00Z'))
    k.store.upsertHeader(acct.id, trash.id, header(3, 'Invoice spam', 'junk@spam.test', '2026-02-03T10:00:00Z'))
    k.store.saveBody(a.id, { textPlain: 'Please find the quarterly numbers attached.', textHtml: null, headers: {}, snippet: 'Please find…' })

    expect(k.search.search('invoice').map((m) => m.uid)).toEqual([1])
    expect(k.search.search('from:acme').map((m) => m.uid)).toEqual([1])
    expect(k.search.search('quarterly numbers').map((m) => m.uid)).toEqual([1])
    expect(k.search.search('"quarterly numbers attached"').map((m) => m.uid)).toEqual([1])
    expect(k.search.search('lunch after:2026-02-02').map((m) => m.uid)).toEqual([2])
    expect(k.search.search('lunch before:2026-02-02')).toEqual([])
    expect(k.search.search('invoice in:trash').map((m) => m.uid)).toEqual([3])
    expect(k.search.search('is:unread').length).toBe(2)
  })
})
