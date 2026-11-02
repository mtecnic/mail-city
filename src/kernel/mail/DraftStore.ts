import { desc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { drafts, type DraftRow } from '../db/schema'
import type { Draft, DraftInput } from '@shared/schemas/compose'
import { DraftInputSchema } from '@shared/schemas/compose'
import { newId } from '../utils/ids'

export class DraftStore {
  constructor(private readonly db: DB) {}

  list(accountId?: string): Draft[] {
    const q = this.db.select().from(drafts)
    return (accountId ? q.where(eq(drafts.accountId, accountId)) : q).orderBy(desc(drafts.updatedAt)).all().map(toDraft)
  }

  get(id: string): Draft | undefined {
    const r = this.getRow(id)
    return r ? toDraft(r) : undefined
  }

  getRow(id: string): DraftRow | undefined {
    return this.db.select().from(drafts).where(eq(drafts.id, id)).get()
  }

  save(input: DraftInput): Draft {
    const d = DraftInputSchema.parse(input)
    const now = new Date().toISOString()
    const id = d.id ?? newId('drf')
    const values = {
      id,
      accountId: d.accountId,
      identityId: d.identityId ?? null,
      toList: d.to,
      ccList: d.cc,
      bccList: d.bcc,
      subject: d.subject,
      html: d.html,
      text: d.text,
      attachments: d.attachments,
      inReplyToMessageId: d.inReplyToMessageId ?? null,
      replyMode: d.replyMode ?? null,
      updatedAt: now,
      createdAt: now
    }
    this.db
      .insert(drafts)
      .values(values)
      .onConflictDoUpdate({ target: drafts.id, set: { ...values, createdAt: undefined } })
      .run()
    return this.get(id)!
  }

  setServerLocation(id: string, folderId: string | null, uid: number | null): void {
    this.db.update(drafts).set({ serverFolderId: folderId, serverUid: uid }).where(eq(drafts.id, id)).run()
  }

  remove(id: string): DraftRow | undefined {
    const row = this.getRow(id)
    if (row) this.db.delete(drafts).where(eq(drafts.id, id)).run()
    return row
  }
}

export function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    accountId: r.accountId,
    identityId: r.identityId,
    to: r.toList,
    cc: r.ccList,
    bcc: r.bccList,
    subject: r.subject,
    html: r.html,
    text: r.text,
    attachments: r.attachments,
    inReplyToMessageId: r.inReplyToMessageId,
    replyMode: (r.replyMode as Draft['replyMode']) ?? null,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt
  }
}
