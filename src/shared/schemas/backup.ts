import { z } from 'zod'
import { RuleSchema } from './rules'

export const BACKUP_FORMAT = 'mail-city-backup'
export const BACKUP_VERSION = 1

/** Unencrypted summary shown before a passphrase is asked for. Contains no addresses or secrets. */
export const BackupHeaderSchema = z.object({
  createdAt: z.string(),
  appVersion: z.string(),
  platform: z.string(),
  counts: z.object({ accounts: z.number(), rules: z.number(), contacts: z.number(), providers: z.number() })
})
export type BackupHeader = z.output<typeof BackupHeaderSchema>

export const BackupAccountSchema = z.object({
  id: z.string(),
  type: z.string(),
  email: z.string(),
  displayName: z.string(),
  imap: z.object({ host: z.string(), port: z.number(), tls: z.string() }),
  smtp: z.object({ host: z.string(), port: z.number(), tls: z.string() }),
  authType: z.string(),
  oauthProvider: z.string().nullable(),
  color: z.string(),
  sortOrder: z.number(),
  enabled: z.boolean(),
  syncSettings: z.record(z.string(), z.unknown()),
  /** Decrypted secrets; re-encrypted with the importing machine's keystore. */
  secrets: z.object({ password: z.string().optional(), refresh_token: z.string().optional(), oauth_meta: z.string().optional() })
})

/** The decrypted payload: everything needed to recreate a setup, nothing from the mail cache. */
export const BackupPayloadSchema = z.object({
  accounts: z.array(BackupAccountSchema),
  identities: z.array(z.object({ id: z.string(), accountId: z.string(), email: z.string(), name: z.string(), signatureId: z.string().nullable(), replyTo: z.string().nullable(), isDefault: z.boolean() })),
  signatures: z.array(z.object({ id: z.string(), name: z.string(), html: z.string(), text: z.string() })),
  rules: z.array(RuleSchema),
  contacts: z.array(z.object({ id: z.string(), name: z.string(), emails: z.array(z.string()), primaryEmail: z.string(), lastSeenAt: z.string().nullable(), sendCount: z.number(), receiveCount: z.number(), source: z.string(), notes: z.string().nullable() })),
  /** Raw settings-table values by key: app, ai, mcp, oauthClients, savedSearches. */
  settings: z.record(z.string(), z.unknown()),
  /** Decrypted vault entries by name (ai.<providerId> API keys, mcp.token). */
  vault: z.record(z.string(), z.string())
})
export type BackupPayload = z.output<typeof BackupPayloadSchema>

export const ImportResultSchema = z.object({
  accounts: z.object({ created: z.number(), updated: z.number() }),
  identities: z.number(),
  signatures: z.number(),
  rules: z.number(),
  contacts: z.number(),
  providers: z.number(),
  vaultEntries: z.number()
})
export type ImportResult = z.output<typeof ImportResultSchema>
