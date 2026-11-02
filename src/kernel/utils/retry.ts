export interface RetryOptions {
  attempts?: number
  baseMs?: number
  maxMs?: number
  factor?: number
  jitter?: boolean
  signal?: AbortSignal
  shouldRetry?: (error: unknown, attempt: number) => boolean
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void
}

export function backoffDelay(attempt: number, { baseMs = 1000, maxMs = 5 * 60_000, factor = 2, jitter = true } = {}): number {
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, attempt))
  return jitter ? Math.round(raw * (0.5 + Math.random() * 0.5)) : raw
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 5
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      if (attempt === attempts - 1 || (opts.shouldRetry && !opts.shouldRetry(e, attempt))) break
      const delay = backoffDelay(attempt, opts)
      opts.onRetry?.(e, attempt, delay)
      await sleep(delay, opts.signal)
    }
  }
  throw lastError
}
