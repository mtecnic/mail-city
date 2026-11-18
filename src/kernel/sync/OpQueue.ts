import { and, asc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { pendingOps, type PendingOpRow } from '../db/schema'
import { newId } from '../utils/ids'

export type PendingOp =
  | { kind: 'setFlags'; folderPath: string; uids: number[]; add: string[]; remove: string[] }
  | { kind: 'move'; folderPath: string; uids: number[]; toPath: string; messageIds: string[] }
  | { kind: 'delete'; folderPath: string; uids: number[] }
  | { kind: 'setLabels'; folderPath: string; uids: number[]; add: string[]; remove: string[] }
  | { kind: 'append'; folderPath: string; mimePath: string; flags: string[]; messageId?: string; /** Local draft whose server copy this is; its UID is recorded on success. */ draftId?: string }
  | { kind: 'createFolder'; path: string }
  | { kind: 'renameFolder'; path: string; newPath: string }
  | { kind: 'deleteFolder'; path: string }

/** Durable per-account queue of server operations, replayed in order. */
export class OpQueue {
  constructor(private readonly db: DB) {}

  enqueue(accountId: string, op: PendingOp): string {
    const id = newId('op')
    this.db.insert(pendingOps).values({ id, accountId, kind: op.kind, payload: op, status: 'queued', attempts: 0, createdAt: new Date().toISOString() }).run()
    return id
  }

  next(accountId: string): PendingOpRow | undefined {
    return this.db
      .select()
      .from(pendingOps)
      .where(and(eq(pendingOps.accountId, accountId), eq(pendingOps.status, 'queued')))
      .orderBy(asc(pendingOps.createdAt))
      .get()
  }

  pendingCount(accountId: string): number {
    return this.db
      .select({ id: pendingOps.id })
      .from(pendingOps)
      .where(and(eq(pendingOps.accountId, accountId), eq(pendingOps.status, 'queued')))
      .all().length
  }

  complete(id: string): void {
    this.db.delete(pendingOps).where(eq(pendingOps.id, id)).run()
  }

  fail(id: string, error: string, giveUp: boolean): void {
    const row = this.db.select().from(pendingOps).where(eq(pendingOps.id, id)).get()
    if (!row) return
    this.db
      .update(pendingOps)
      .set({ attempts: row.attempts + 1, lastError: error, status: giveUp ? 'failed' : 'queued' })
      .where(eq(pendingOps.id, id))
      .run()
  }

  /** Re-queue everything marked running (e.g. after a crash). */
  resetRunning(accountId: string): void {
    this.db
      .update(pendingOps)
      .set({ status: 'queued' })
      .where(and(eq(pendingOps.accountId, accountId), eq(pendingOps.status, 'running')))
      .run()
  }

  /** A move that has not reached the server yet and carries this message (for undo / re-move). */
  queuedMoveFor(accountId: string, messageId: string): { id: string; op: Extract<PendingOp, { kind: 'move' }> } | undefined {
    const rows = this.db
      .select()
      .from(pendingOps)
      .where(and(eq(pendingOps.accountId, accountId), eq(pendingOps.status, 'queued'), eq(pendingOps.kind, 'move')))
      .orderBy(asc(pendingOps.createdAt))
      .all()
    for (const r of rows) {
      const op = r.payload as Extract<PendingOp, { kind: 'move' }>
      if (op.messageIds?.includes(messageId)) return { id: r.id, op }
    }
    return undefined
  }

  /** Replace a queued op's payload (only while it is still queued). */
  replace(id: string, op: PendingOp): void {
    this.db.update(pendingOps).set({ payload: op }).where(and(eq(pendingOps.id, id), eq(pendingOps.status, 'queued'))).run()
  }

  markRunning(id: string): void {
    this.db.update(pendingOps).set({ status: 'running' }).where(eq(pendingOps.id, id)).run()
  }
}
