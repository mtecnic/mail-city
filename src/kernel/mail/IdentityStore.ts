import { and, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { identities, signatures } from '../db/schema'
import type { Identity, Signature } from '@shared/schemas/compose'
import { newId } from '../utils/ids'

export class IdentityStore {
  constructor(private readonly db: DB) {}

  list(accountId?: string): Identity[] {
    const q = this.db.select().from(identities)
    return (accountId ? q.where(eq(identities.accountId, accountId)) : q).all()
  }

  get(id: string): Identity | undefined {
    return this.db.select().from(identities).where(eq(identities.id, id)).get()
  }

  defaultFor(accountId: string): Identity | undefined {
    return (
      this.db
        .select()
        .from(identities)
        .where(and(eq(identities.accountId, accountId), eq(identities.isDefault, true)))
        .get() ?? this.list(accountId)[0]
    )
  }

  /** Find the identity whose address appears among recipients (for "reply from the address they wrote to"). */
  matching(accountId: string, addresses: string[]): Identity | undefined {
    const set = new Set(addresses.map((a) => a.toLowerCase()))
    return this.list(accountId).find((i) => set.has(i.email.toLowerCase()))
  }

  create(input: { accountId: string; email: string; name: string; signatureId?: string | null; replyTo?: string | null; isDefault?: boolean }): Identity {
    const id = newId('idn')
    if (input.isDefault) this.db.update(identities).set({ isDefault: false }).where(eq(identities.accountId, input.accountId)).run()
    this.db
      .insert(identities)
      .values({ id, accountId: input.accountId, email: input.email.toLowerCase(), name: input.name, signatureId: input.signatureId ?? null, replyTo: input.replyTo ?? null, isDefault: !!input.isDefault })
      .run()
    return this.get(id)!
  }

  update(id: string, patch: Partial<Pick<Identity, 'email' | 'name' | 'signatureId' | 'replyTo' | 'isDefault'>>): void {
    const row = this.get(id)
    if (!row) return
    if (patch.isDefault) this.db.update(identities).set({ isDefault: false }).where(eq(identities.accountId, row.accountId)).run()
    this.db.update(identities).set(patch).where(eq(identities.id, id)).run()
  }

  remove(id: string): void {
    const row = this.get(id)
    if (!row || row.isDefault) return
    this.db.delete(identities).where(eq(identities.id, id)).run()
  }

  // ---- signatures ---------------------------------------------------------

  listSignatures(): Signature[] {
    return this.db.select().from(signatures).all()
  }

  getSignature(id: string): Signature | undefined {
    return this.db.select().from(signatures).where(eq(signatures.id, id)).get()
  }

  saveSignature(input: { id?: string; name: string; html: string; text: string }): Signature {
    const id = input.id ?? newId('sig')
    this.db
      .insert(signatures)
      .values({ id, name: input.name, html: input.html, text: input.text })
      .onConflictDoUpdate({ target: signatures.id, set: { name: input.name, html: input.html, text: input.text } })
      .run()
    return this.getSignature(id)!
  }

  deleteSignature(id: string): void {
    this.db.update(identities).set({ signatureId: null }).where(eq(identities.signatureId, id)).run()
    this.db.delete(signatures).where(eq(signatures.id, id)).run()
  }
}
