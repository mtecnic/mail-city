/**
 * Local message persistence shared by the sync engine (writes) and the
 * MessageService (reads + optimistic updates).
 */
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { DB } from '../db'
import { attachments, folders, messageBodies, messages, type Address, type FolderRow, type MessageFlags, type MessageRow } from '../db/schema'
import type { HeaderRecord } from '../providers/ImapProvider'
import { toAddresses } from './addresses'
import { flagsFromSet } from './flags'
import { listAttachments, hasRealAttachments } from './bodystructure'
import { assignThread, normalizeSubject } from './threading'
import { newId } from '../utils/ids'

export interface MessageListItem {
  id: string
  accountId: string
  folderId: string
  uid: number
  threadId: string | null
  subject: string
  from: Address
  to: Address[]
  date: string
  snippet: string
  flags: MessageFlags
  hasAttachments: boolean
  labels: string[]
  aiCategory: string | null
  aiPriority: number | null
  threadCount: number
  threadUnread: number
}

export interface ListMessagesQuery {
  accountId?: string
  folderId?: string
  specialUse?: string
  unreadOnly?: boolean
  flaggedOnly?: boolean
  /** ISO date cursor: return messages older than this. */
  before?: string
  limit?: number
  threadId?: string
}

export class MessageStore {
  constructor(private readonly db: DB) {}

  // ---- folders ----------------------------------------------------------

  listFolders(accountId?: string): FolderRow[] {
    const q = this.db.select().from(folders)
    return (accountId ? q.where(eq(folders.accountId, accountId)) : q).all().sort((a, b) => a.sortOrder - b.sortOrder || a.path.localeCompare(b.path))
  }

  getFolder(id: string): FolderRow | undefined {
    return this.db.select().from(folders).where(eq(folders.id, id)).get()
  }

  folderByPath(accountId: string, path: string): FolderRow | undefined {
    return this.db
      .select()
      .from(folders)
      .where(and(eq(folders.accountId, accountId), eq(folders.path, path)))
      .get()
  }

  folderBySpecialUse(accountId: string, specialUse: string): FolderRow | undefined {
    return this.db
      .select()
      .from(folders)
      .where(and(eq(folders.accountId, accountId), eq(folders.specialUse, specialUse)))
      .get()
  }

  upsertFolder(row: typeof folders.$inferInsert): FolderRow {
    const existing = this.folderByPath(row.accountId, row.path)
    if (existing) {
      this.db
        .update(folders)
        .set({ name: row.name, delimiter: row.delimiter, specialUse: row.specialUse, subscribed: row.subscribed, sortOrder: row.sortOrder })
        .where(eq(folders.id, existing.id))
        .run()
      return this.getFolder(existing.id)!
    }
    this.db.insert(folders).values(row).run()
    return this.getFolder(row.id)!
  }

  updateFolder(id: string, patch: Partial<typeof folders.$inferInsert>): void {
    this.db.update(folders).set(patch).where(eq(folders.id, id)).run()
  }

  deleteFolder(id: string): void {
    this.db.delete(folders).where(eq(folders.id, id)).run()
  }

  /** Wipe cached messages for a folder (UIDVALIDITY change). */
  clearFolderMessages(folderId: string): void {
    this.db.delete(messages).where(eq(messages.folderId, folderId)).run()
  }

  refreshFolderCounts(folderId: string): void {
    const r = this.db
      .select({
        total: sql<number>`count(*)`,
        unread: sql<number>`sum(case when json_extract(${messages.flags}, '$.seen') = 0 then 1 else 0 end)`
      })
      .from(messages)
      .where(eq(messages.folderId, folderId))
      .get()
    this.db
      .update(folders)
      .set({ totalCount: r?.total ?? 0, unreadCount: r?.unread ?? 0 })
      .where(eq(folders.id, folderId))
      .run()
  }

  // ---- messages ---------------------------------------------------------

  uidsInFolder(folderId: string): Map<number, string> {
    const rows = this.db.select({ uid: messages.uid, id: messages.id }).from(messages).where(eq(messages.folderId, folderId)).all()
    return new Map(rows.map((r) => [r.uid, r.id]))
  }

  maxUid(folderId: string): number {
    const r = this.db.select({ m: sql<number>`coalesce(max(${messages.uid}), 0)` }).from(messages).where(eq(messages.folderId, folderId)).get()
    return r?.m ?? 0
  }

  getMessage(id: string): MessageRow | undefined {
    return this.db.select().from(messages).where(eq(messages.id, id)).get()
  }

  getByUid(folderId: string, uid: number): MessageRow | undefined {
    return this.db
      .select()
      .from(messages)
      .where(and(eq(messages.folderId, folderId), eq(messages.uid, uid)))
      .get()
  }

  getBody(messageId: string) {
    return this.db.select().from(messageBodies).where(eq(messageBodies.messageId, messageId)).get()
  }

  getAttachments(messageId: string) {
    return this.db.select().from(attachments).where(eq(attachments.messageId, messageId)).all()
  }

  getAttachment(id: string) {
    return this.db.select().from(attachments).where(eq(attachments.id, id)).get()
  }

  /** Insert or update a header record from IMAP. Returns the message id and whether it was new. */
  upsertHeader(accountId: string, folderId: string, h: HeaderRecord): { id: string; isNew: boolean } {
    const existing = this.getByUid(folderId, h.uid)
    const flags = flagsFromSet(h.flags)
    const labels = h.labels ? [...h.labels] : []
    if (existing) {
      this.db.update(messages).set({ flags, labels }).where(eq(messages.id, existing.id)).run()
      return { id: existing.id, isNew: false }
    }
    const env = h.envelope
    const id = newId('msg')
    const from = toAddresses(env.from)[0] ?? { name: '', address: '' }
    const date = env.date ? new Date(env.date) : h.internalDate
    const validDate = Number.isNaN(date.getTime()) ? h.internalDate : date
    const attList = listAttachments(h.bodyStructure)
    const references = (h.headers['references'] ?? '')
      .split(/\s+/)
      .map((r) => r.trim())
      .filter(Boolean)
    const messageId = env.messageId?.trim() || null
    const inReplyTo = env.inReplyTo?.trim() || null
    const subject = env.subject ?? ''
    const threadId = assignThread(
      { id, messageId, inReplyTo, references, subject, gmThreadId: h.threadId ?? null, date: validDate },
      {
        byMessageId: (mid) => this.db.select({ t: messages.threadId }).from(messages).where(and(eq(messages.accountId, accountId), eq(messages.messageId, mid))).get()?.t ?? undefined,
        bySubject: (norm, newerThan) =>
          this.db
            .select({ t: messages.threadId, s: messages.subject })
            .from(messages)
            .where(and(eq(messages.accountId, accountId), gt(messages.date, newerThan.toISOString())))
            .orderBy(desc(messages.date))
            .limit(200)
            .all()
            .find((r) => normalizeSubject(r.s) === norm)?.t ?? undefined
      }
    )
    this.db
      .insert(messages)
      .values({
        id,
        accountId,
        folderId,
        uid: h.uid,
        messageId,
        threadId,
        gmThreadId: h.threadId ?? null,
        inReplyTo,
        references,
        subject,
        fromName: from.name,
        fromAddr: from.address,
        toList: toAddresses(env.to),
        ccList: toAddresses(env.cc),
        bccList: toAddresses(env.bcc),
        replyTo: toAddresses(env.replyTo),
        date: validDate.toISOString(),
        internalDate: h.internalDate.toISOString(),
        sizeBytes: h.size,
        flags,
        labels,
        snippet: '',
        hasAttachments: hasRealAttachments(attList),
        bodyState: 'headers',
        listUnsubscribe: h.headers['list-unsubscribe'] ?? null,
        listId: h.headers['list-id'] ?? null,
        createdAt: new Date().toISOString()
      })
      .run()
    if (attList.length) {
      this.db
        .insert(attachments)
        .values(attList.map((a) => ({ id: newId('att'), messageId: id, part: a.part, filename: a.filename, mimeType: a.mimeType, size: a.size, contentId: a.contentId, isInline: a.isInline })))
        .run()
    }
    return { id, isNew: true }
  }

  updateFlags(folderId: string, uid: number, flags: Set<string>, labels?: Set<string>): string | undefined {
    const row = this.getByUid(folderId, uid)
    if (!row) return undefined
    const patch: Partial<typeof messages.$inferInsert> = { flags: flagsFromSet(flags) }
    if (labels) patch.labels = [...labels]
    this.db.update(messages).set(patch).where(eq(messages.id, row.id)).run()
    return row.id
  }

  setLocalFlags(ids: string[], patch: Partial<MessageFlags>): void {
    for (const id of ids) {
      const row = this.getMessage(id)
      if (!row) continue
      this.db
        .update(messages)
        .set({ flags: { ...row.flags, ...patch } })
        .where(eq(messages.id, id))
        .run()
    }
  }

  deleteByUids(folderId: string, uids: number[]): string[] {
    if (!uids.length) return []
    const rows = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.folderId, folderId), inArray(messages.uid, uids)))
      .all()
    const ids = rows.map((r) => r.id)
    if (ids.length) this.db.delete(messages).where(inArray(messages.id, ids)).run()
    return ids
  }

  deleteByIds(ids: string[]): void {
    if (ids.length) this.db.delete(messages).where(inArray(messages.id, ids)).run()
  }

  /** Move a cached message to another folder locally (uid may be unknown until the server tells us). */
  moveLocal(id: string, toFolderId: string, newUid: number | null): void {
    // Negative placeholder UIDs keep the unique index happy until the next sync assigns the real one.
    const uid = newUid ?? -Math.floor(Math.random() * 1e9) - 1
    this.db.update(messages).set({ folderId: toFolderId, uid }).where(eq(messages.id, id)).run()
  }

  saveBody(messageId: string, body: { textPlain: string | null; textHtml: string | null; headers: Record<string, string>; snippet: string; rawPath?: string | null }): void {
    const now = new Date().toISOString()
    this.db
      .insert(messageBodies)
      .values({ messageId, textPlain: body.textPlain, textHtml: body.textHtml, headers: body.headers, rawPath: body.rawPath ?? null, fetchedAt: now })
      .onConflictDoUpdate({ target: messageBodies.messageId, set: { textPlain: body.textPlain, textHtml: body.textHtml, headers: body.headers, rawPath: body.rawPath ?? null, fetchedAt: now } })
      .run()
    this.db.update(messages).set({ bodyState: 'full', snippet: body.snippet }).where(eq(messages.id, messageId)).run()
  }

  setAttachmentPath(attachmentId: string, localPath: string, size?: number): void {
    this.db
      .update(attachments)
      .set({ localPath, ...(size !== undefined ? { size } : {}) })
      .where(eq(attachments.id, attachmentId))
      .run()
  }

  replaceAttachments(messageId: string, list: { part: string | null; filename: string; mimeType: string; size: number; contentId: string | null; isInline: boolean; localPath: string | null }[]): void {
    this.db.delete(attachments).where(eq(attachments.messageId, messageId)).run()
    if (list.length) this.db.insert(attachments).values(list.map((a) => ({ id: newId('att'), messageId, ...a }))).run()
    this.db.update(messages).set({ hasAttachments: list.some((a) => !a.isInline) }).where(eq(messages.id, messageId)).run()
  }

  // ---- list queries -------------------------------------------------------

  list(q: ListMessagesQuery): MessageListItem[] {
    const limit = Math.min(q.limit ?? 50, 500)
    const where = [] as ReturnType<typeof eq>[]
    if (q.accountId) where.push(eq(messages.accountId, q.accountId))
    if (q.folderId) where.push(eq(messages.folderId, q.folderId))
    if (q.threadId) where.push(eq(messages.threadId, q.threadId))
    if (q.unreadOnly) where.push(sql`json_extract(${messages.flags}, '$.seen') = 0` as never)
    if (q.flaggedOnly) where.push(sql`json_extract(${messages.flags}, '$.flagged') = 1` as never)
    if (q.before) where.push(lt(messages.date, q.before))
    if (!q.threadId) where.push(or(isNull(messages.snoozedUntil), lt(messages.snoozedUntil, new Date().toISOString())) as never)

    if (q.specialUse && !q.folderId) {
      const folderIds = this.db
        .select({ id: folders.id })
        .from(folders)
        .where(q.accountId ? and(eq(folders.specialUse, q.specialUse), eq(folders.accountId, q.accountId)) : eq(folders.specialUse, q.specialUse))
        .all()
        .map((r) => r.id)
      if (!folderIds.length) return []
      where.push(inArray(messages.folderId, folderIds))
    }
    const rows: MessageRow[] = this.db
      .select()
      .from(messages)
      .where(and(...where))
      .orderBy(q.threadId ? messages.date : desc(messages.date))
      .limit(limit)
      .all()

    const threadIds = [...new Set(rows.map((r) => r.threadId).filter((t): t is string => !!t))]
    const counts = new Map<string, { n: number; unread: number }>()
    if (threadIds.length) {
      for (const r of this.db
        .select({ t: messages.threadId, n: sql<number>`count(*)`, unread: sql<number>`sum(case when json_extract(${messages.flags}, '$.seen') = 0 then 1 else 0 end)` })
        .from(messages)
        .where(inArray(messages.threadId, threadIds))
        .groupBy(messages.threadId)
        .all()) {
        if (r.t) counts.set(r.t, { n: r.n, unread: r.unread })
      }
    }
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      folderId: r.folderId,
      uid: r.uid,
      threadId: r.threadId,
      subject: r.subject,
      from: { name: r.fromName, address: r.fromAddr },
      to: r.toList,
      date: r.date,
      snippet: r.snippet,
      flags: r.flags,
      hasAttachments: r.hasAttachments,
      labels: r.labels,
      aiCategory: r.aiCategory,
      aiPriority: r.aiPriority,
      threadCount: r.threadId ? (counts.get(r.threadId)?.n ?? 1) : 1,
      threadUnread: r.threadId ? (counts.get(r.threadId)?.unread ?? 0) : r.flags.seen ? 0 : 1
    }))
  }

  unreadTotal(accountId?: string): number {
    const q = this.db
      .select({ n: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(folders, eq(folders.id, messages.folderId))
    const base = and(eq(folders.specialUse, 'inbox'), sql`json_extract(${messages.flags}, '$.seen') = 0`)
    return (accountId ? q.where(and(base, eq(messages.accountId, accountId))) : q.where(base)).get()?.n ?? 0
  }
}
