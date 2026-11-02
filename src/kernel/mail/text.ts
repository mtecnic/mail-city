/** Cheap HTML → text for snippets and FTS (real rendering is sanitized in the renderer). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function makeSnippet(text: string, max = 160): string {
  const s = text
    .split('\n')
    .filter((l) => !/^>/.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
