/**
 * Error classification shared by the sync loop and the main-process safety net.
 * A "transient network error" is what a sleeping laptop, a dropped Wi-Fi link or a
 * server closing an idle connection produces. It is expected, recoverable, and must
 * never be shown to the user as a failure.
 */
const CODES = /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNABORTED|EPIPE|ENETUNREACH|EHOSTUNREACH|ENETDOWN|ENETRESET|EADDRNOTAVAIL|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_CONNECTION_\w+|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT)\b/i
const PHRASES = /socket hang up|socket timeout|connection (closed|not available|reset|lost)|unexpected close|timed out|network (is )?(unreachable|down|changed)|getaddrinfo|client network socket disconnected|tls connection|read ECONN|write EPIPE/i

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: unknown }).code
    return `${typeof code === 'string' ? `${code} ` : ''}${e.message}`
  }
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

export function isTransientNetworkError(e: unknown): boolean {
  const text = errorText(e)
  return CODES.test(text) || PHRASES.test(text)
}
