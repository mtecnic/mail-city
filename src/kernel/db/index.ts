import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { migrations } from './migrations'
import { createLogger } from '../utils/logger'

const log = createLogger('db')

export type DB = BetterSQLite3Database<typeof schema>

export interface OpenDbOptions {
  /** Absolute path, or ':memory:' for tests. */
  path: string
  /** Try to load the sqlite-vec extension (vector search). Default true. */
  loadVec?: boolean
}

export interface DbHandle {
  db: DB
  raw: Database.Database
  hasVec: boolean
  close(): void
}

export function openDb(opts: OpenDbOptions): DbHandle {
  const raw = new Database(opts.path)
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = NORMAL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('temp_store = MEMORY')
  raw.pragma('cache_size = -32000') // 32 MB

  let hasVec = false
  if (opts.loadVec !== false) {
    try {
      // Lazy import so environments without the native extension still work.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec') as { load(db: Database.Database): void }
      sqliteVec.load(raw)
      hasVec = true
    } catch (e) {
      log.warn('sqlite-vec not available; semantic search disabled', { error: String(e) })
    }
  }

  migrate(raw, hasVec)

  const db = drizzle(raw, { schema })
  return {
    db,
    raw,
    hasVec,
    close: () => raw.close()
  }
}

function migrate(raw: Database.Database, hasVec: boolean): void {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`)
  const applied = new Set(
    (raw.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  )
  const run = raw.transaction((m: { version: number; name: string; sql: string }) => {
    raw.exec(m.sql)
    raw.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, new Date().toISOString())
  })
  for (const m of migrations) {
    if (applied.has(m.version)) continue
    log.info(`applying migration ${m.version} (${m.name})`)
    run(m)
  }
  if (hasVec) {
    // Vector table lives outside the numbered migrations because it depends on the extension being loadable.
    raw.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS message_vectors USING vec0(
      message_id TEXT,
      chunk_index INTEGER,
      embedding FLOAT[768]
    )`)
  }
}

export { schema }
