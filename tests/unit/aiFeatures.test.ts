import { describe, it, expect } from 'vitest'
import { chunkText, rrf } from '@kernel/ai/embeddings/Indexer'
import { unsubscribeOptions, localPhishingHeuristics, eventToIcs } from '@kernel/ai/features'
import type { MessageDetail } from '@kernel/mail/MessageService'

const base: MessageDetail = {
  id: 'm',
  accountId: 'a',
  folderId: 'f',
  folderPath: 'INBOX',
  threadId: null,
  subject: 'Your account',
  from: { name: 'PayPal Support', address: 'help@paypa1-secure.ru' },
  to: [],
  cc: [],
  bcc: [],
  replyTo: [{ name: '', address: 'x@other.example' }],
  date: '2026-01-01T00:00:00Z',
  flags: { seen: true, flagged: false, answered: false, draft: false, deleted: false },
  labels: [],
  messageId: null,
  inReplyTo: null,
  references: [],
  listUnsubscribe: '<mailto:unsub@list.example?subject=unsubscribe>, <https://list.example/u/123>',
  bodyState: 'full',
  textPlain: 'Unusual activity detected. Verify your account within 24 hours.',
  textHtml: '<a href="http://1.2.3.4/login">login</a>',
  headers: { 'list-unsubscribe-post': 'List-Unsubscribe=One-Click', 'authentication-results': 'spf=fail dkim=fail' },
  attachments: [],
  aiSummary: null,
  aiExtract: null,
  aiCategory: null
}

describe('indexer helpers', () => {
  it('chunks long text with overlap on word boundaries', () => {
    const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
    const chunks = chunkText(text, 500, 50)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500)
    expect(chunks[1]!.split(' ')[0]).toMatch(/^word\d+$/)
    expect(chunkText('short')).toEqual(['short'])
    expect(chunkText('   ')).toEqual([])
  })
  it('fuses ranked lists', () => {
    expect(rrf([['a', 'b', 'c'], ['c', 'a', 'd']])).toEqual(['a', 'c', 'b', 'd'])
  })
})

describe('unsubscribe + phishing heuristics', () => {
  it('parses List-Unsubscribe variants', () => {
    const o = unsubscribeOptions(base)
    expect(o).toEqual([
      { kind: 'mailto', url: 'mailto:unsub@list.example?subject=unsubscribe', to: 'unsub@list.example', subject: 'unsubscribe' },
      { kind: 'one-click', url: 'https://list.example/u/123' }
    ])
    expect(unsubscribeOptions({ ...base, listUnsubscribe: null, headers: {}, textHtml: '<a href="https://x.example/unsubscribe?u=1&amp;t=2">bye</a>' })).toEqual([{ kind: 'link', url: 'https://x.example/unsubscribe?u=1&t=2' }])
  })
  it('flags obvious phishing signals', () => {
    const r = localPhishingHeuristics(base, ['http://1.2.3.4/login'])
    expect(r).toEqual(expect.arrayContaining([expect.stringContaining('Reply-To'), expect.stringContaining('paypal'), expect.stringContaining('IP'), expect.stringContaining('Urgency'), expect.stringContaining('SPF')]))
  })
  it('builds an ics', () => {
    const ics = eventToIcs({ title: 'Lunch, with Bob', start: '2026-05-01T12:00:00Z', end: '2026-05-01T13:00:00Z', location: null, allDay: false }, 'm1')
    expect(ics).toContain('DTSTART:20260501T120000Z')
    expect(ics).toContain('SUMMARY:Lunch\\, with Bob')
  })
})
