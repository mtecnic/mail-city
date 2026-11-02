import { asc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { accounts, identities, type AccountRow } from '../db/schema'
import type { AccountSummary, AccountType, ServerConfig } from '@shared/schemas/account'
import { SecretStore, type SecretCipher } from './SecretStore'
import { newId } from '../utils/ids'
import { TypedEmitter } from '../utils/emitter'

export interface NewAccountInput {
  type: AccountType
  email: string
  displayName: string
  imap: ServerConfig
  smtp: ServerConfig
  auth: { type: 'password'; password: string } | { type: 'oauth2'; provider: 'google' | 'microsoft'; refreshToken: string; accessToken?: string; expiresAt?: Date }
  color?: string
}

const PALETTE = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626']

export class AccountStore extends TypedEmitter<{ changed: [] }> {
  readonly secrets: SecretStore

  constructor(
    private readonly db: DB,
    cipher: SecretCipher
  ) {
    super()
    this.secrets = new SecretStore(db, cipher)
  }

  list(): AccountSummary[] {
    return this.db.select().from(accounts).orderBy(asc(accounts.sortOrder), asc(accounts.createdAt)).all().map(toSummary)
  }

  get(id: string): AccountRow | null {
    return this.db.select().from(accounts).where(eq(accounts.id, id)).get() ?? null
  }

  create(input: NewAccountInput): AccountSummary {
    const id = newId('acct')
    const count = this.list().length
    const row: typeof accounts.$inferInsert = {
      id,
      type: input.type,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim() || input.email,
      imapHost: input.imap.host,
      imapPort: input.imap.port,
      imapTls: input.imap.tls,
      smtpHost: input.smtp.host,
      smtpPort: input.smtp.port,
      smtpTls: input.smtp.tls,
      authType: input.auth.type,
      oauthProvider: input.auth.type === 'oauth2' ? input.auth.provider : null,
      color: input.color ?? PALETTE[count % PALETTE.length]!,
      sortOrder: count,
      enabled: true,
      syncSettings: {},
      createdAt: new Date().toISOString()
    }
    this.db.transaction((tx) => {
      tx.insert(accounts).values(row).run()
      tx.insert(identities)
        .values({ id: newId('idn'), accountId: id, email: row.email, name: row.displayName, isDefault: true })
        .run()
    })
    if (input.auth.type === 'password') {
      this.secrets.set(id, 'password', input.auth.password)
    } else {
      this.secrets.set(id, 'refresh_token', input.auth.refreshToken)
      if (input.auth.accessToken) this.secrets.set(id, 'access_token', input.auth.accessToken, input.auth.expiresAt ?? null)
    }
    this.emit('changed')
    return toSummary(this.get(id)!)
  }

  update(id: string, patch: Partial<Pick<AccountRow, 'displayName' | 'color' | 'sortOrder' | 'enabled' | 'syncSettings' | 'imapHost' | 'imapPort' | 'imapTls' | 'smtpHost' | 'smtpPort' | 'smtpTls' | 'lastError' | 'lastSyncAt'>>): void {
    this.db.update(accounts).set(patch).where(eq(accounts.id, id)).run()
    this.emit('changed')
  }

  remove(id: string): void {
    this.db.delete(accounts).where(eq(accounts.id, id)).run() // cascades to everything
    this.emit('changed')
  }
}

export function toSummary(r: AccountRow): AccountSummary {
  return {
    id: r.id,
    type: r.type as AccountType,
    email: r.email,
    displayName: r.displayName,
    color: r.color,
    sortOrder: r.sortOrder,
    authType: r.authType as 'oauth2' | 'password',
    enabled: r.enabled,
    lastSyncAt: r.lastSyncAt,
    lastError: r.lastError
  }
}
