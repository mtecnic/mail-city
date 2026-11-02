import { and, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { secrets } from '../db/schema'

/** Abstraction over Electron's safeStorage so the kernel stays Electron-free. */
export interface SecretCipher {
  encrypt(plain: string): string // returns base64 ciphertext
  decrypt(ciphertext: string): string
  isAvailable(): boolean
}

/** Used in tests and headless mode when no OS keystore exists. Not secure. */
export const plainCipher: SecretCipher = {
  encrypt: (p) => Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (c) => Buffer.from(c, 'base64').toString('utf8'),
  isAvailable: () => true
}

export type SecretKind = 'password' | 'refresh_token' | 'access_token' | 'oauth_meta'

export class SecretStore {
  constructor(
    private readonly db: DB,
    private readonly cipher: SecretCipher
  ) {}

  set(accountId: string, kind: SecretKind, value: string, expiresAt?: Date | null): void {
    const now = new Date().toISOString()
    this.db
      .insert(secrets)
      .values({ accountId, kind, ciphertext: this.cipher.encrypt(value), expiresAt: expiresAt?.toISOString() ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: [secrets.accountId, secrets.kind],
        set: { ciphertext: this.cipher.encrypt(value), expiresAt: expiresAt?.toISOString() ?? null, updatedAt: now }
      })
      .run()
  }

  get(accountId: string, kind: SecretKind): { value: string; expiresAt: Date | null } | null {
    const row = this.db
      .select()
      .from(secrets)
      .where(and(eq(secrets.accountId, accountId), eq(secrets.kind, kind)))
      .get()
    if (!row) return null
    return { value: this.cipher.decrypt(row.ciphertext), expiresAt: row.expiresAt ? new Date(row.expiresAt) : null }
  }

  delete(accountId: string, kind?: SecretKind): void {
    const where = kind ? and(eq(secrets.accountId, accountId), eq(secrets.kind, kind)) : eq(secrets.accountId, accountId)
    this.db.delete(secrets).where(where).run()
  }
}
