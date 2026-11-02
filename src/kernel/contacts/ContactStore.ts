import { eq, sql, inArray } from 'drizzle-orm'
import type { DB } from '../db'
import { contacts, type ContactRow, type Address } from '../db/schema'
import { newId } from '../utils/ids'
import { parseVCards, toVCards } from './vcard'

export interface ContactSuggestion {
  id: string
  name: string
  address: string
  score: number
}

const IGNORE = /^(no-?reply|noreply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce|alerts?)[@+.-]/i

export class ContactStore {
  constructor(private readonly db: DB) {}

  list(): ContactRow[] {
    return this.db.select().from(contacts).orderBy(sql`lower(${contacts.name}), ${contacts.primaryEmail}`).all()
  }

  get(id: string): ContactRow | undefined {
    return this.db.select().from(contacts).where(eq(contacts.id, id)).get()
  }

  byEmail(email: string): ContactRow | undefined {
    return this.db.select().from(contacts).where(eq(contacts.primaryEmail, email.toLowerCase())).get()
  }

  /** Record the people on a message. `direction` decides which counter to bump. */
  harvest(addresses: Address[], direction: 'received' | 'sent', when: Date): void {
    const seen = new Set<string>()
    for (const a of addresses) {
      const email = a.address.toLowerCase().trim()
      if (!email.includes('@') || seen.has(email) || IGNORE.test(email)) continue
      seen.add(email)
      const existing = this.byEmail(email)
      if (existing) {
        const better = a.name && (!existing.name || existing.source === 'harvested') && a.name.length > existing.name.length
        this.db
          .update(contacts)
          .set({
            name: better ? a.name : existing.name,
            lastSeenAt: !existing.lastSeenAt || existing.lastSeenAt < when.toISOString() ? when.toISOString() : existing.lastSeenAt,
            sendCount: direction === 'sent' ? existing.sendCount + 1 : existing.sendCount,
            receiveCount: direction === 'received' ? existing.receiveCount + 1 : existing.receiveCount
          })
          .where(eq(contacts.id, existing.id))
          .run()
      } else {
        this.db
          .insert(contacts)
          .values({
            id: newId('ct'),
            name: a.name ?? '',
            emails: [email],
            primaryEmail: email,
            lastSeenAt: when.toISOString(),
            sendCount: direction === 'sent' ? 1 : 0,
            receiveCount: direction === 'received' ? 1 : 0,
            source: 'harvested'
          })
          .onConflictDoNothing()
          .run()
      }
    }
  }

  /** Autocomplete, ranked by how often we write to them, then recency. */
  suggest(prefix: string, limit = 8): ContactSuggestion[] {
    const p = prefix.trim().toLowerCase()
    if (!p) return []
    const like = `%${p.replace(/[%_]/g, '\\$&')}%`
    const rows = this.db
      .select()
      .from(contacts)
      .where(sql`lower(${contacts.name}) LIKE ${like} ESCAPE '\\' OR ${contacts.primaryEmail} LIKE ${like} ESCAPE '\\' OR ${contacts.emails} LIKE ${like} ESCAPE '\\'`)
      .limit(200)
      .all()
    const now = Date.now()
    return rows
      .flatMap((r) => r.emails.map((address) => ({ r, address })))
      .filter(({ r, address }) => address.includes(p) || r.name.toLowerCase().includes(p))
      .map(({ r, address }) => {
        const starts = address.startsWith(p) || r.name.toLowerCase().startsWith(p) ? 2 : 0
        const recency = r.lastSeenAt ? Math.max(0, 1 - (now - new Date(r.lastSeenAt).getTime()) / (365 * 86_400_000)) : 0
        const score = starts + r.sendCount * 3 + r.receiveCount * 0.5 + recency * 2 + (r.source === 'manual' ? 1 : 0)
        return { id: r.id, name: r.name, address, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }

  save(input: { id?: string; name: string; emails: string[]; notes?: string | null }): ContactRow {
    const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))]
    if (!emails.length) throw new Error('A contact needs at least one email address')
    const id = input.id ?? this.byEmail(emails[0]!)?.id ?? newId('ct')
    const existing = this.get(id)
    const values = { name: input.name.trim(), emails, primaryEmail: emails[0]!, notes: input.notes ?? null, source: 'manual' as const }
    if (existing) this.db.update(contacts).set(values).where(eq(contacts.id, id)).run()
    else this.db.insert(contacts).values({ id, ...values, sendCount: 0, receiveCount: 0 }).run()
    return this.get(id)!
  }

  remove(id: string): void {
    this.db.delete(contacts).where(eq(contacts.id, id)).run()
  }

  /** Merge contacts into the first one (union of emails, max counters). */
  merge(ids: string[]): ContactRow | undefined {
    const rows = this.db.select().from(contacts).where(inArray(contacts.id, ids)).all()
    const target = rows.find((r) => r.id === ids[0])
    if (!target) return undefined
    const emails = [...new Set(rows.flatMap((r) => r.emails))]
    this.db
      .update(contacts)
      .set({
        name: rows.map((r) => r.name).sort((a, b) => b.length - a.length)[0] ?? target.name,
        emails,
        sendCount: rows.reduce((n, r) => n + r.sendCount, 0),
        receiveCount: rows.reduce((n, r) => n + r.receiveCount, 0),
        lastSeenAt: rows.map((r) => r.lastSeenAt).filter(Boolean).sort().pop() ?? null,
        source: 'manual'
      })
      .where(eq(contacts.id, target.id))
      .run()
    this.db.delete(contacts).where(inArray(contacts.id, ids.slice(1))).run()
    return this.get(target.id)
  }

  /** Candidates for merging: same display name with different emails. */
  duplicates(): ContactRow[][] {
    const byName = new Map<string, ContactRow[]>()
    for (const c of this.list()) {
      const k = c.name.trim().toLowerCase()
      if (!k) continue
      byName.set(k, [...(byName.get(k) ?? []), c])
    }
    return [...byName.values()].filter((g) => g.length > 1)
  }

  importVcf(text: string): number {
    let n = 0
    for (const c of parseVCards(text)) {
      this.save({ name: c.name, emails: c.emails, notes: c.notes })
      n++
    }
    return n
  }

  exportVcf(): string {
    return toVCards(this.list().map((c) => ({ name: c.name, emails: c.emails, notes: c.notes ?? undefined })))
  }
}
