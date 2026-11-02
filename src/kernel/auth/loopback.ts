import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LoopbackResult {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Mail City</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0b0d12;color:#e6e8ee}
div{text-align:center}h1{font-weight:600}p{color:#8b93a5}</style></head>
<body><div><h1>Signed in</h1><p>You can close this tab and return to Mail City.</p></div></body></html>`

const ERROR_HTML = (msg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Mail City</title></head><body style="font-family:system-ui"><h1>Sign-in failed</h1><p>${escapeHtml(msg)}</p></body></html>`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Starts a one-shot HTTP server on 127.0.0.1 (random port) and resolves with the
 * query parameters of the first request to `callbackPath`.
 */
export async function waitForLoopbackCallback(opts: { callbackPath?: string; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{
  redirectUri: string
  result: Promise<LoopbackResult>
  close(): void
}> {
  const callbackPath = opts.callbackPath ?? '/callback'
  let resolveResult!: (r: LoopbackResult) => void
  let rejectResult!: (e: Error) => void
  const result = new Promise<LoopbackResult>((res, rej) => {
    resolveResult = res
    rejectResult = rej
  })

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== callbackPath) {
      res.writeHead(404).end()
      return
    }
    const q = url.searchParams
    const r: LoopbackResult = {
      code: q.get('code') ?? undefined,
      state: q.get('state') ?? undefined,
      error: q.get('error') ?? undefined,
      errorDescription: q.get('error_description') ?? undefined
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(r.error ? ERROR_HTML(r.errorDescription ?? r.error) : SUCCESS_HTML)
    resolveResult(r)
    setTimeout(close, 250)
  })

  await new Promise<void>((res, rej) => {
    server.once('error', rej)
    server.listen(0, '127.0.0.1', () => res())
  })
  const port = (server.address() as AddressInfo).port
  const timer = setTimeout(() => {
    rejectResult(new Error('Sign-in timed out'))
    close()
  }, opts.timeoutMs ?? 5 * 60_000)
  opts.signal?.addEventListener(
    'abort',
    () => {
      rejectResult(new Error('Sign-in cancelled'))
      close()
    },
    { once: true }
  )

  function close() {
    clearTimeout(timer)
    server.close()
  }

  return { redirectUri: `http://127.0.0.1:${port}${callbackPath}`, result, close }
}
