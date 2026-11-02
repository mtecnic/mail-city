import { z } from 'zod'

/** User-editable OAuth client configuration (Settings → Accounts → OAuth clients). */
export const OAuthClientConfigSchema = z.object({
  google: z
    .object({
      clientId: z.string().default(''),
      clientSecret: z.string().default('')
    })
    .default({ clientId: '', clientSecret: '' }),
  microsoft: z
    .object({
      clientId: z.string().default(''),
      /** 'common' (personal + work), 'consumers', 'organizations' or a tenant id. */
      tenant: z.string().default('common')
    })
    .default({ clientId: '', tenant: 'common' })
})
export type OAuthClientConfig = z.output<typeof OAuthClientConfigSchema>

export const OAuthStartResultSchema = z.object({
  /** One-time ticket consumed by accounts.create; tokens never leave the main process. */
  ticket: z.string(),
  provider: z.enum(['google', 'microsoft']),
  email: z.string(),
  displayName: z.string()
})
export type OAuthStartResult = z.output<typeof OAuthStartResultSchema>
