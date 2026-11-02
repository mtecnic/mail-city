/**
 * Background semantic index: chunks message text, embeds it with the routed
 * embedding model, stores vectors in sqlite-vec, and offers hybrid search
 * (BM25 via FTS5 ∪ kNN, fused with reciprocal rank).
 */
import type Database from 'better-sqlite3'
import { and, eq, gt, ne } from 'drizzle-orm'
import type { DB } from '../../db'
import { messages } from '../../db/schema'
import type { AiService } from '../AiService'
import type { MessageStore, MessageListItem } from '../../mail/MessageStore'
import type { SearchService } from '../../search/SearchService'
import { htmlToText } from '../../mail/text'
import { createLogger } from '../../utils/logger'
import { TypedEmitter } from '../../utils/emitter'

const log = createLogger('ai:index')
const CHUNK_CHARS = 1800
const CHUNK_OVERLAP = 200
const BATCH = 16

export interface IndexStatus {
  available: boolean
  model: string | null
  dimension: number | null
  indexed: number
  pending: number
  running: boolean
  lastError: string | null
}

export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  const out: string[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size)
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end)
      const sp = clean.lastIndexOf(' ', end)
      const cut = Math.max(nl, sp)
      if (cut > i + size / 2) end = cut
    }
    out.push(clean.slice(i, end).trim())
    if (end >= clean.length) break
    let next = Math.max(end - overlap, i + 1)
    // Start the overlap on a word boundary so no chunk begins mid-word.
    const ws = clean.indexOf(' ', next)
    if (ws > 0 && ws < end) next = ws + 1
    i = next
  }
  return out.filter(Boolean)
}

/** Reciprocal rank fusion of ranked id lists. */
export function rrf(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>()
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)))
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

export class EmbeddingIndexer extends TypedEmitter<{ progress: [IndexStatus] }> {
  private running = false
  private timer: NodeJS.Timeout | null = null
  private lastError: string | null = null
  private tableReady = false
  private dim: number | null = null
  private model: string | null = null

  constructor(
    private readonly raw: Database.Database,
    private readonly db: DB,
    private readonly hasVec: boolean,
    private readonly ai: AiService,
    private readonly store: MessageStore,
    private readonly search: SearchService,
    private readonly windowDays: () => number,
    private readonly enabled: () => boolean
  ) {
    super()
    this.loadState()
  }

  private loadState() {
    const row = this.raw.prepare(`SELECT value_json FROM vector_index_state WHERE key = 'model'`).get() as { value_json: string } | undefined
    if (row) {
      const v = JSON.parse(row.value_json) as { model: string; dim: number }
      this.model = v.model
      this.dim = v.dim
    }
  }

  private saveState() {
    this.raw.prepare(`INSERT INTO vector_index_state (key, value_json) VALUES ('model', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify({ model: this.model, dim: this.dim }))
  }

  get available(): boolean {
    return this.hasVec
  }

  status(): IndexStatus {
    const indexed = this.raw.prepare(`SELECT count(*) n FROM messages WHERE index_state = 'vec'`).get() as { n: number }
    const pending = this.pendingCount()
    return { available: this.hasVec, model: this.model, dimension: this.dim, indexed: indexed.n, pending, running: this.running, lastError: this.lastError }
  }

  private pendingCount(): number {
    const since = new Date(Date.now() - this.windowDays() * 86_400_000).toISOString()
    return (this.raw.prepare(`SELECT count(*) n FROM messages WHERE index_state != 'vec' AND body_state = 'full' AND date > ?`).get(since) as { n: number }).n
  }

  start(): void {
    if (!this.hasVec || this.timer) return
    this.timer = setInterval(() => void this.tick(), 20_000)
    setTimeout(() => void this.tick(), 5000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private ensureTable(dim: number, model: string) {
    if (this.model && this.model !== model) {
      log.info('embedding model changed; rebuilding index', { from: this.model, to: model })
      this.raw.exec(`DROP TABLE IF EXISTS message_vectors`)
      this.raw.prepare(`UPDATE messages SET index_state = 'fts' WHERE index_state = 'vec'`).run()
      this.tableReady = false
    }
    if (!this.tableReady) {
      this.raw.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS message_vectors USING vec0(message_id TEXT, chunk_index INTEGER, embedding FLOAT[${dim}])`)
      this.tableReady = true
    }
    this.model = model
    this.dim = dim
    this.saveState()
  }

  /** Index a batch of pending messages. Returns how many were indexed. */
  async tick(limit = BATCH): Promise<number> {
    if (!this.hasVec || this.running || !this.enabled()) return 0
    const route = this.ai.routeFor('embeddings')
    if (!route?.provider.embed) return 0
    this.running = true
    let done = 0
    try {
      const since = new Date(Date.now() - this.windowDays() * 86_400_000).toISOString()
      const rows = this.db
        .select({ id: messages.id, subject: messages.subject, fromName: messages.fromName, fromAddr: messages.fromAddr })
        .from(messages)
        .where(and(ne(messages.indexState, 'vec'), eq(messages.bodyState, 'full'), gt(messages.date, since)))
        .limit(limit)
        .all()
      if (!rows.length) return 0
      const chunks: { id: string; idx: number; text: string }[] = []
      for (const r of rows) {
        const body = this.store.getBody(r.id)
        const text = body?.textPlain ?? (body?.textHtml ? htmlToText(body.textHtml) : '')
        const head = `Subject: ${r.subject}\nFrom: ${r.fromName} <${r.fromAddr}>\n\n`
        chunkText(head + text).slice(0, 12).forEach((c, idx) => chunks.push({ id: r.id, idx, text: c }))
        if (!text.trim()) chunks.push({ id: r.id, idx: 0, text: head })
      }
      const vectors = await route.provider.embed(chunks.map((c) => c.text), route.model)
      const dim = vectors[0]?.length
      if (!dim) throw new Error('Embedding model returned no vectors')
      this.ensureTable(dim, route.model)
      const del = this.raw.prepare(`DELETE FROM message_vectors WHERE message_id = ?`)
      const ins = this.raw.prepare(`INSERT INTO message_vectors (message_id, chunk_index, embedding) VALUES (?, ?, ?)`)
      const mark = this.raw.prepare(`UPDATE messages SET index_state = 'vec' WHERE id = ?`)
      this.raw.transaction(() => {
        for (const r of rows) del.run(r.id)
        chunks.forEach((c, i) => ins.run(c.id, BigInt(c.idx), Buffer.from(new Float32Array(vectors[i]!).buffer)))
        for (const r of rows) mark.run(r.id)
      })()
      done = rows.length
      this.lastError = null
      this.ai.logRun({ feature: 'embeddings', providerId: route.provider.id, model: route.model, durationMs: 0, messageIds: rows.map((r) => r.id), ok: true, error: null })
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      log.warn('index tick failed', { error: this.lastError })
    } finally {
      this.running = false
      this.emit('progress', this.status())
    }
    return done
  }

  /** Nearest messages by meaning. */
  async semantic(query: string, limit = 20): Promise<string[]> {
    if (!this.hasVec || !this.tableReady && !this.dim) return []
    const route = this.ai.routeFor('embeddings')
    if (!route?.provider.embed) return []
    const [vec] = await route.provider.embed([query], route.model)
    if (!vec) return []
    if (!this.tableReady) this.ensureTable(vec.length, route.model)
    const rows = this.raw
      .prepare(`SELECT message_id, min(distance) d FROM message_vectors WHERE embedding MATCH ? AND k = ? GROUP BY message_id ORDER BY d`)
      .all(Buffer.from(new Float32Array(vec).buffer), limit * 3) as { message_id: string; d: number }[]
    return rows.slice(0, limit).map((r) => r.message_id)
  }

  /** Hybrid: FTS (BM25) ∪ semantic, fused with reciprocal rank. */
  async hybrid(query: string, limit = 20): Promise<MessageListItem[]> {
    const fts = this.search.search(query, { limit }).map((m) => m.id)
    let sem: string[] = []
    try {
      sem = await this.semantic(query, limit)
    } catch (e) {
      log.debug('semantic search unavailable', { error: String(e) })
    }
    const ids = rrf([fts, sem]).slice(0, limit)
    return this.store.listByIds(ids)
  }

  /** Drop vectors for deleted messages (called occasionally). */
  vacuum(): void {
    if (!this.hasVec || !this.tableReady) return
    this.raw.exec(`DELETE FROM message_vectors WHERE message_id NOT IN (SELECT id FROM messages)`)
  }
}
