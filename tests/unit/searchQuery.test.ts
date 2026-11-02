import { describe, it, expect } from 'vitest'
import { parseQuery } from '@kernel/search/query'
import { parseVCards, toVCards } from '@kernel/contacts/vcard'
import { snoozePreset } from '@kernel/mail/Snooze'

describe('parseQuery', () => {
  it('turns free text into prefix matches and recognizes operators', () => {
    const q = parseQuery('invoice from:acme has:attachment is:unread "exact phrase" larger:2mb after:2026-01-01')
    expect(q.match).toBe('"invoice"* AND from_text:"acme"* AND "exact phrase"')
    expect(q.hasAttachment).toBe(true)
    expect(q.unread).toBe(true)
    expect(q.larger).toBe(2_000_000)
    expect(q.after?.startsWith('202')).toBe(true)
  })

  it('handles filter-only queries and quoted operator values', () => {
    const q = parseQuery('in:"Receipts 2026" is:starred')
    expect(q.match).toBeNull()
    expect(q.folderName).toBe('Receipts 2026')
    expect(q.flagged).toBe(true)
  })

  it('neutralizes FTS operators in user input', () => {
    const q = parseQuery('foo OR bar NOT* "quo"te"')
    expect(q.match).toBe('"foo"* AND "OR"* AND "bar"* AND "NOT"* AND "quo" AND "te"*')
  })
})

describe('vCard', () => {
  it('round-trips contacts', () => {
    const text = toVCards([{ name: 'Ada Lovelace', emails: ['ada@example.com', 'ada.l@example.org'], notes: 'Math, computing' }])
    const parsed = parseVCards(text)
    expect(parsed).toEqual([{ name: 'Ada Lovelace', emails: ['ada@example.com', 'ada.l@example.org'], notes: 'Math, computing' }])
  })
  it('reads folded lines and N when FN is missing', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Turing;Alan;;;\r\nEMAIL;TYPE=INTERNET:alan@\r\n example.com\r\nEND:VCARD\r\n'
    expect(parseVCards(vcf)).toEqual([{ name: 'Alan Turing', emails: ['alan@example.com'], notes: undefined }])
  })
})

describe('snoozePreset', () => {
  it('computes tomorrow 8am and next Monday', () => {
    const wed = new Date(2026, 10, 4, 15, 30) // Wednesday
    expect(snoozePreset('tomorrow', wed).getHours()).toBe(8)
    expect(snoozePreset('tomorrow', wed).getDate()).toBe(5)
    expect(snoozePreset('nextWeek', wed).getDay()).toBe(1)
    expect(snoozePreset('thisWeekend', wed).getDay()).toBe(6)
  })
})
