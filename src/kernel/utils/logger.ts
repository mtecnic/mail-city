/**
 * Minimal logger abstraction. The kernel never imports electron-log directly;
 * the main process installs a sink (`setLogSink`) that forwards to electron-log.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogSink {
  log(level: LogLevel, scope: string, message: string, meta?: unknown): void
}

const consoleSink: LogSink = {
  log(level, scope, message, meta) {
    const line = `[${scope}] ${message}`
    const fn = level === 'debug' ? console.debug : level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
    if (meta === undefined) fn(line)
    else fn(line, meta)
  }
}

let sink: LogSink = consoleSink

export function setLogSink(next: LogSink): void {
  sink = next
}

const SECRET_KEYS = /pass(word)?|secret|token|authorization|cookie/i

/** Replace secret-looking fields in structured metadata before logging. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) ? '<redacted>' : redact(v, depth + 1)
  }
  return out as T
}

export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
  child(scope: string): Logger
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, meta?: unknown) =>
    sink.log(level, scope, message, meta === undefined ? undefined : redact(meta))
  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    child: (sub) => createLogger(`${scope}:${sub}`)
  }
}
