/**
 * Typed IPC contract shared by main, preload and renderer.
 *
 * Every request/response channel is declared once here with zod schemas.
 * - main validates `input` before calling the handler and `output` before replying
 * - preload only forwards channels listed here
 * - renderer gets full type inference via `window.mail.invoke(...)`
 *
 * Events (main -> renderer) are declared in `events` the same way.
 */
import { z } from 'zod'
import { AppSettingsSchema } from './schemas/settings'
import { AccountSummarySchema, AccountTypeSchema, ServerConfigSchema } from './schemas/account'
import { OAuthClientConfigSchema, OAuthStartResultSchema } from './schemas/oauth'
import { FolderSchema, ListMessagesQuerySchema, MessageDetailSchema, MessageFlagsSchema, MessageListItemSchema } from './schemas/mail'

export function defineChannel<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(input: I, output: O) {
  return { input, output }
}

export const DiscoveryResultSchema = z.object({
  email: z.string(),
  domain: z.string(),
  type: AccountTypeSchema,
  providerLabel: z.string(),
  source: z.enum(['known', 'mx', 'ispdb', 'autoconfig', 'srv', 'guess', 'none']),
  imap: ServerConfigSchema.optional(),
  smtp: ServerConfigSchema.optional(),
  username: z.string(),
  auth: z.enum(['oauth2', 'password']),
  oauthProvider: z.enum(['google', 'microsoft']).optional(),
  passwordHint: z.string().optional(),
  helpUrl: z.string().optional()
})

export const CreateAccountRequestSchema = z.object({
  type: AccountTypeSchema,
  email: z.string().email(),
  displayName: z.string(),
  imap: ServerConfigSchema,
  smtp: ServerConfigSchema,
  auth: z.discriminatedUnion('type', [
    z.object({ type: z.literal('password'), password: z.string().min(1) }),
    z.object({ type: z.literal('oauth2'), ticket: z.string().min(1) })
  ])
})

export const ConnectionTestResultSchema = z.object({
  imap: z.object({ ok: z.boolean(), error: z.string().optional(), capabilities: z.array(z.string()).optional() }),
  smtp: z.object({ ok: z.boolean(), error: z.string().optional() })
})

export const channels = {
  'app.version': defineChannel(z.void(), z.object({ version: z.string(), electron: z.string() })),
  'app.openExternal': defineChannel(z.object({ url: z.string().url() }), z.void()),

  'settings.get': defineChannel(z.void(), AppSettingsSchema),
  'settings.set': defineChannel(z.record(z.string(), z.unknown()), AppSettingsSchema),

  'accounts.list': defineChannel(z.void(), z.array(AccountSummarySchema)),
  'accounts.discover': defineChannel(z.object({ email: z.string().email() }), DiscoveryResultSchema),
  'accounts.test': defineChannel(CreateAccountRequestSchema, ConnectionTestResultSchema),
  'accounts.create': defineChannel(CreateAccountRequestSchema, AccountSummarySchema),
  'accounts.update': defineChannel(
    z.object({
      id: z.string(),
      patch: z.object({ displayName: z.string().optional(), color: z.string().optional(), enabled: z.boolean().optional(), sortOrder: z.number().int().optional() })
    }),
    z.void()
  ),
  'accounts.remove': defineChannel(z.object({ id: z.string() }), z.void()),

  'oauth.start': defineChannel(z.object({ provider: z.enum(['google', 'microsoft']), loginHint: z.string().optional() }), OAuthStartResultSchema),
  'oauth.config.get': defineChannel(z.void(), z.object({ user: OAuthClientConfigSchema, hasGoogle: z.boolean(), hasMicrosoft: z.boolean() })),
  'oauth.config.set': defineChannel(OAuthClientConfigSchema, z.void()),

  'folders.list': defineChannel(z.object({ accountId: z.string().optional() }), z.array(FolderSchema)),
  'folders.sync': defineChannel(z.object({ accountId: z.string(), folderId: z.string() }), z.void()),

  'messages.list': defineChannel(ListMessagesQuerySchema, z.array(MessageListItemSchema)),
  'messages.thread': defineChannel(z.object({ threadId: z.string() }), z.array(MessageListItemSchema)),
  'messages.get': defineChannel(z.object({ id: z.string(), fetchBody: z.boolean().optional() }), MessageDetailSchema),
  'messages.setFlags': defineChannel(z.object({ ids: z.array(z.string()).min(1), flags: MessageFlagsSchema.partial() }), z.void()),
  'messages.move': defineChannel(z.object({ ids: z.array(z.string()).min(1), toFolderId: z.string() }), z.void()),
  'messages.archive': defineChannel(z.object({ ids: z.array(z.string()).min(1) }), z.void()),
  'messages.delete': defineChannel(z.object({ ids: z.array(z.string()).min(1) }), z.void()),
  'messages.junk': defineChannel(z.object({ ids: z.array(z.string()).min(1), junk: z.boolean() }), z.void()),
  'messages.unreadCount': defineChannel(z.object({ accountId: z.string().optional() }), z.number()),

  'attachments.open': defineChannel(z.object({ id: z.string() }), z.object({ ok: z.boolean(), error: z.string().optional() })),
  'attachments.saveAs': defineChannel(z.object({ id: z.string() }), z.object({ ok: z.boolean(), path: z.string().optional() })),
  'attachments.dataUrl': defineChannel(z.object({ id: z.string() }), z.string().nullable()),

  'sync.now': defineChannel(z.object({ accountId: z.string().optional() }), z.void())
} as const

export type Channels = typeof channels
export type ChannelName = keyof Channels
export type ChannelInput<C extends ChannelName> = z.input<Channels[C]['input']>
/** What a main-process handler receives: the input after zod parsing (defaults applied). */
export type ChannelParsedInput<C extends ChannelName> = z.output<Channels[C]['input']>
export type ChannelOutput<C extends ChannelName> = z.output<Channels[C]['output']>

export const events = {
  'sync.status': z.object({
    accountId: z.string(),
    state: z.enum(['idle', 'syncing', 'error', 'offline']),
    detail: z.string().optional()
  }),
  'settings.changed': AppSettingsSchema,
  'accounts.changed': z.void(),
  'folders.changed': z.object({ accountId: z.string() }),
  'messages.changed': z.object({ accountId: z.string(), folderId: z.string() }),
  'messages.new': z.object({ accountId: z.string(), folderId: z.string(), ids: z.array(z.string()) }),
  'messages.bodyFetched': z.object({ id: z.string() })
} as const

export type Events = typeof events
export type EventName = keyof Events
export type EventPayload<E extends EventName> = z.output<Events[E]>

export const channelNames = Object.keys(channels) as ChannelName[]
export const eventNames = Object.keys(events) as EventName[]
