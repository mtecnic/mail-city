import type Database from 'better-sqlite3'
import type { MessageStore, MessageListItem } from '../mail/MessageStore'
import type { AccountStore } from '../accounts/AccountStore'
import { parseQuery, type ParsedQuery } from './query'

export interface SearchOptions {
  accountId?: string
  folderId?: string
  limit?: number
  offset?: number
}

/**
 * Full-text search over the local cache. Uses the `messages_fts` FTS5 table
 * (populated by MessageStore) joined back to `messages` for filters and ordering.
 */
export class SearchService {
  constructor(
    private readonly raw: Database.Database,
    private readonly store: MessageStore,
    private readonly accounts: AccountStore
  ) {}

  parse(query: string): ParsedQuery {
    return parseQuery(query)
  }

  search(query: string, opts: SearchOptions = {}): MessageListItem[] {
    const q = parseQuery(query)
    const limit = Math.min(opts.limit ?? 100, 500)
    const params: unknown[] = []
    const where: string[] = []

    let fromClause = 'FROM messages m'
    if (q.match) {
      fromClause = 'FROM messages_fts JOIN messages m ON m.id = messages_fts.message_id'
      where.push('messages_fts MATCH ?')
      params.push(q.match)
    }
    if (opts.accountId) {
      where.push('m.account_id = ?')
      params.push(opts.accountId)
    } else if (q.account) {
      const acct = this.accounts.list().find((a) => a.email.includes(q.account!.toLowerCase()) || a.displayName.toLowerCase().includes(q.account!.toLowerCase()))
      if (acct) {
        where.push('m.account_id = ?')
        params.push(acct.id)
      }
    }
    if (opts.folderId) {
      where.push('m.folder_id = ?')
      params.push(opts.folderId)
    } else if (q.folderName) {
      const ids = this.store
        .listFolders()
        .filter((f) => f.name.toLowerCase() === q.folderName!.toLowerCase() || f.path.toLowerCase() === q.folderName!.toLowerCase() || f.specialUse === q.folderName!.toLowerCase())
        .map((f) => f.id)
      if (ids.length) {
        where.push(`m.folder_id IN (${ids.map(() => '?').join(',')})`)
        params.push(...ids)
      } else {
        return []
      }
    } else {
      // By default exclude trash/junk from search results.
      const excluded = this.store
        .listFolders()
        .filter((f) => f.specialUse === 'trash' || f.specialUse === 'junk')
        .map((f) => f.id)
      if (excluded.length) {
        where.push(`m.folder_id NOT IN (${excluded.map(() => '?').join(',')})`)
        params.push(...excluded)
      }
    }
    if (q.hasAttachment) where.push('m.has_attachments = 1')
    if (q.unread === true) where.push("json_extract(m.flags_json, '$.seen') = 0")
    if (q.unread === false) where.push("json_extract(m.flags_json, '$.seen') = 1")
    if (q.flagged) where.push("json_extract(m.flags_json, '$.flagged') = 1")
    if (q.before) {
      where.push('m.date < ?')
      params.push(q.before)
    }
    if (q.after) {
      where.push('m.date >= ?')
      params.push(q.after)
    }
    if (q.larger) {
      where.push('m.size_bytes > ?')
      params.push(q.larger)
    }
    if (q.smaller) {
      where.push('m.size_bytes < ?')
      params.push(q.smaller)
    }
    if (!q.match && !where.length) return []

    // Rank: strong text relevance first, then recency. bm25 is negative (lower = better).
    const order = q.match ? "ORDER BY (bm25(messages_fts) * 0.6 - (julianday(m.date) - julianday('now')) * 0.01) ASC" : 'ORDER BY m.date DESC'
    const sql = `SELECT m.id ${fromClause} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${order} LIMIT ? OFFSET ?`
    params.push(limit, opts.offset ?? 0)
    const ids = (this.raw.prepare(sql).all(...params) as { id: string }[]).map((r) => r.id)
    return this.store.listByIds(ids)
  }
}
