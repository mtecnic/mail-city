import { describe, it, expect } from 'vitest'
import { parseMailto } from '../../src/main/protocol'

describe('parseMailto', () => {
  it('parses addresses and query parameters', () => {
    const r = parseMailto('mailto:a@x.io,b@y.io?cc=c@z.io&subject=Hello%20there&body=Line1%0ALine2')
    expect(r).toEqual({ to: ['a@x.io', 'b@y.io'], cc: ['c@z.io'], bcc: [], subject: 'Hello there', body: 'Line1\nLine2' })
  })
  it('handles bare mailto: and non-mailto input', () => {
    expect(parseMailto('mailto:')).toEqual({ to: [], cc: [], bcc: [], subject: '', body: '' })
    expect(parseMailto('https://example.com')).toBeNull()
  })
})
