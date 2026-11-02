import { describe, it, expect } from 'vitest'
import { buildMime, quoteMessage, replyRecipients, replySubject } from '@kernel/mail/compose'
import { parseAddressList, formatAddress } from '@kernel/mail/addresses'
import type { MessageDetail } from '@kernel/mail/MessageService'

const msg: MessageDetail = {
  id: 'msg_1',
  accountId: 'acct_1',
  folderId: 'fld_1',
  folderPath: 'INBOX',
  threadId: 't:1',
  subject: 'Quarterly numbers',
  from: { name: 'Alice', address: 'alice@example.com' },
  to: [{ name: 'Me', address: 'me@example.com' }, { name: 'Bob', address: 'bob@example.com' }],
  cc: [{ name: '', address: 'carol@example.com' }],
  bcc: [],
  replyTo: [],
  date: '2026-03-01T10:00:00Z',
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  labels: [],
  messageId: '<orig@example.com>',
  inReplyTo: null,
  references: [],
  listUnsubscribe: null,
  bodyState: 'full',
  textPlain: 'Hi,\nnumbers attached.',
  textHtml: '<p>Hi,<br>numbers attached.</p>',
  headers: null,
  attachments: [],
  aiSummary: null,
  aiCategory: null
}

describe('compose helpers', () => {
  it('computes reply recipients without echoing ourselves', () => {
    expect(replyRecipients(msg, 'reply', ['me@example.com'])).toEqual({ to: [msg.from], cc: [] })
    const all = replyRecipients(msg, 'replyAll', ['me@example.com'])
    expect(all.to.map((a) => a.address)).toEqual(['alice@example.com'])
    expect(all.cc.map((a) => a.address)).toEqual(['bob@example.com', 'carol@example.com'])
    expect(replyRecipients(msg, 'forward', [])).toEqual({ to: [], cc: [] })
  })

  it('prefixes subjects once', () => {
    expect(replySubject('Hello', 'reply')).toBe('Re: Hello')
    expect(replySubject('Re: Hello', 'replyAll')).toBe('Re: Hello')
    expect(replySubject('Hello', 'forward')).toBe('Fwd: Hello')
  })

  it('quotes html and text', () => {
    const q = quoteMessage(msg, 'reply')
    expect(q.html).toContain('<blockquote')
    expect(q.html).toContain('numbers attached')
    expect(q.text).toContain('> numbers attached.')
    const f = quoteMessage(msg, 'forward')
    expect(f.text).toContain('Forwarded message')
    expect(f.text).toContain('From: Alice <alice@example.com>')
  })

  it('parses and formats address lists', () => {
    expect(parseAddressList('Alice <a@x.io>, b@y.io, "Smith, J" <j@z.io>')).toEqual([
      { name: 'Alice', address: 'a@x.io' },
      { name: '', address: 'b@y.io' },
      { name: 'Smith, J', address: 'j@z.io' }
    ])
    expect(formatAddress({ name: 'Smith, J', address: 'j@z.io' })).toBe('"Smith, J" <j@z.io>')
  })

  it('builds a multipart MIME with threading headers', async () => {
    const built = await buildMime({
      from: { name: 'Me', address: 'me@example.com' },
      to: [{ name: 'Alice', address: 'alice@example.com' }],
      cc: [],
      bcc: [{ name: '', address: 'secret@example.com' }],
      subject: 'Re: Quarterly numbers',
      html: '<p>Thanks!</p>',
      text: 'Thanks!',
      attachments: [],
      inReplyTo: '<orig@example.com>',
      references: ['<orig@example.com>']
    })
    const raw = built.raw.toString()
    expect(raw).toMatch(/^From: Me <me@example.com>/m)
    expect(raw).toMatch(/^In-Reply-To: <orig@example.com>/m)
    expect(raw).toMatch(/^References: <orig@example.com>/m)
    expect(raw).toContain('multipart/alternative')
    expect(raw).not.toContain('secret@example.com') // bcc stays out of headers
    expect(built.envelope.to).toEqual(['alice@example.com', 'secret@example.com'])
    expect(built.messageId).toMatch(/^<.+@example\.com>$/)
  })
})
