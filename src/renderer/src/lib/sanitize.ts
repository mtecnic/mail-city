import DOMPurify from 'dompurify'

export interface SanitizeOptions {
  /** Map of Content-ID → data: URL for inline images. */
  cid: Record<string, string>
  /** Whether remote http(s) images may load. */
  allowRemoteImages: boolean
}

let configured = false
function configure() {
  if (configured) return
  configured = true
  // Force every link to open in a new (intercepted → external browser) window and strip target tricks.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

export interface SanitizedHtml {
  html: string
  blockedRemoteImages: number
}

const REMOTE_IMAGE_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')

export function sanitizeEmailHtml(input: string, opts: SanitizeOptions): SanitizedHtml {
  configure()
  let blocked = 0
  const clean = DOMPurify.sanitize(input, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'link', 'base', 'svg', 'math'],
    FORBID_ATTR: ['onerror', 'onload', 'formaction', 'srcdoc'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    RETURN_DOM: true
  }) as unknown as HTMLElement

  for (const img of Array.from(clean.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (src.startsWith('cid:')) {
      const data = opts.cid[src.slice(4).replace(/^<|>$/g, '')]
      if (data) img.setAttribute('src', data)
      else img.removeAttribute('src')
    } else if (/^https?:/i.test(src)) {
      if (!opts.allowRemoteImages) {
        img.setAttribute('data-remote-src', src)
        img.setAttribute('src', REMOTE_IMAGE_PLACEHOLDER)
        blocked++
      }
    } else if (!src.startsWith('data:')) {
      img.removeAttribute('src')
    }
  }
  // Background images in inline styles can also phone home.
  if (!opts.allowRemoteImages) {
    for (const el of Array.from(clean.querySelectorAll<HTMLElement>('[style]'))) {
      const style = el.getAttribute('style') ?? ''
      if (/url\(\s*['"]?https?:/i.test(style)) {
        el.setAttribute('style', style.replace(/url\(\s*['"]?https?:[^)]*\)/gi, 'none'))
        blocked++
      }
    }
  }
  return { html: clean.innerHTML, blockedRemoteImages: blocked }
}

export function textToHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  const linked = esc.replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
  return `<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;margin:0">${linked}</pre>`
}

/** Document wrapper used inside the sandboxed iframe. */
export function wrapForFrame(bodyHtml: string, dark: boolean): string {
  const fg = dark ? '#e6e8ee' : '#15171c'
  const bg = dark ? '#0b0d12' : '#ffffff'
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data:;">
<style>
  :root{color-scheme:${dark ? 'dark' : 'light'}}
  html,body{margin:0;padding:12px 16px;background:${bg};color:${fg};font:14px/1.5 'Segoe UI',system-ui,sans-serif;word-break:break-word}
  img{max-width:100%;height:auto}
  a{color:#4f8cff}
  blockquote{border-left:3px solid #888;margin:8px 0;padding-left:12px;color:#8b93a5}
  table{max-width:100%}
  pre{white-space:pre-wrap}
</style></head><body>${bodyHtml}</body></html>`
}
