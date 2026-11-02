import { z } from 'zod'

export const AccountTypeSchema = z.enum(['gmail', 'outlook', 'icloud', 'yahoo', 'imap'])
export type AccountType = z.output<typeof AccountTypeSchema>

export const AuthTypeSchema = z.enum(['oauth2', 'password'])
export const OAuthProviderSchema = z.enum(['google', 'microsoft'])

export const TlsModeSchema = z.enum(['tls', 'starttls', 'none'])

export const ServerConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  tls: TlsModeSchema
})
export type ServerConfig = z.output<typeof ServerConfigSchema>

export const AccountSummarySchema = z.object({
  id: z.string(),
  type: AccountTypeSchema,
  email: z.string(),
  displayName: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  authType: AuthTypeSchema,
  enabled: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable()
})
export type AccountSummary = z.output<typeof AccountSummarySchema>
