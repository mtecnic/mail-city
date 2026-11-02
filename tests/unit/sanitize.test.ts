// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { sanitizeEmailHtml, textToHtml } from '../../src/renderer/src/lib/sanitize'

const PAYLOADS = [
  '<img src=x onerror="alert(1)">',
  '<script>alert(1)</script><p>hi</p>',
  '<a href="javascript:alert(1)">x</a>',
  '<iframe src="https://evil.example"></iframe>',
  '<form action="https://evil.example"><input name=pw></form>',
  '<svg onload="alert(1)"><circle/></svg>',
  '<div style="background:url(https://track.example/p.gif)">x</div>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<object data="https://evil.example"></object>',
  '<a href="https://ok.example" target="_top">ok</a>'
]

describe('email HTML sanitizer', () => {
  it('strips scripts, handlers, frames, forms and javascript: links', () => {
    for (const p of PAYLOADS) {
      const { html } = sanitizeEmailHtml(p, { cid: {}, allowRemoteImages: false })
      expect(html).not.toMatch(/<script|onerror|onload|javascript:|<iframe|<form|<object|<meta|<svg/i)
    }
  })
  it('blocks remote images and background urls, keeps cid and data images', () => {
    const r = sanitizeEmailHtml('<img src="https://t.example/p.gif"><img src="cid:logo"><img src="data:image/png;base64,AAAA"><div style="background:url(https://t.example/x.png)">x</div>', { cid: { logo: 'data:image/png;base64,BBBB' }, allowRemoteImages: false })
    expect(r.blockedRemoteImages).toBe(2)
    expect(r.html).toContain('data-remote-src="https://t.example/p.gif"')
    expect(r.html).toContain('src="data:image/png;base64,BBBB"')
    expect(r.html).toContain('src="data:image/png;base64,AAAA"')
    expect(r.html).not.toContain('url(https://t.example/x.png)')
    const allowed = sanitizeEmailHtml('<img src="https://t.example/p.gif">', { cid: {}, allowRemoteImages: true })
    expect(allowed.blockedRemoteImages).toBe(0)
    expect(allowed.html).toContain('src="https://t.example/p.gif"')
  })
  it('forces links to open externally and escapes plain text', () => {
    const r = sanitizeEmailHtml('<a href="https://ok.example">ok</a>', { cid: {}, allowRemoteImages: true })
    expect(r.html).toContain('target="_blank"')
    expect(r.html).toContain('rel="noopener noreferrer"')
    expect(textToHtml('<b>x</b> see https://a.example/path')).toBe('<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;margin:0">&lt;b&gt;x&lt;/b&gt; see <a href="https://a.example/path">https://a.example/path</a></pre>')
  })
})
