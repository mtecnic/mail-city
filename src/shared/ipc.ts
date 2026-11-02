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
import { DraftAttachmentSchema, DraftInputSchema, DraftSchema, IdentitySchema, OutboxItemSchema, ReplyModeSchema, ReplyTemplateSchema, SignatureSchema } from './schemas/compose'
import { RuleInputSchema, RuleSchema } from './schemas/rules'

export const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  primaryEmail: z.string(),
  lastSeenAt: z.string().nullable(),
  sendCount: z.number(),
  receiveCount: z.number(),
  source: z.string(),
  notes: z.string().nullable()
})
export const SavedSearchSchema = z.object({ id: z.string(), name: z.string(), query: z.string() })
export const SavedSearchesSchema = z.array(SavedSearchSchema).default([])

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

  'sync.now': defineChannel(z.object({ accountId: z.string().optional() }), z.void()),

  // ---- compose ------------------------------------------------------------
  'compose.replyTemplate': defineChannel(z.object({ messageId: z.string(), mode: ReplyModeSchema }), ReplyTemplateSchema),
  'compose.pickAttachments': defineChannel(z.void(), z.array(DraftAttachmentSchema)),
  'compose.send': defineChannel(z.object({ draft: DraftInputSchema, scheduledAt: z.string().optional() }), OutboxItemSchema),
  'drafts.list': defineChannel(z.object({ accountId: z.string().optional() }), z.array(DraftSchema)),
  'drafts.get': defineChannel(z.object({ id: z.string() }), DraftSchema.nullable()),
  'drafts.save': defineChannel(DraftInputSchema, DraftSchema),
  'drafts.syncToServer': defineChannel(z.object({ id: z.string() }), z.void()),
  'drafts.discard': defineChannel(z.object({ id: z.string() }), z.void()),
  'outbox.list': defineChannel(z.void(), z.array(OutboxItemSchema)),
  'outbox.cancel': defineChannel(z.object({ id: z.string() }), DraftSchema.nullable()),
  'outbox.retry': defineChannel(z.object({ id: z.string() }), z.void()),
  'identities.list': defineChannel(z.object({ accountId: z.string().optional() }), z.array(IdentitySchema)),
  'identities.create': defineChannel(
    z.object({ accountId: z.string(), email: z.string().email(), name: z.string(), signatureId: z.string().nullable().optional(), replyTo: z.string().nullable().optional(), isDefault: z.boolean().optional() }),
    IdentitySchema
  ),
  'identities.update': defineChannel(
    z.object({ id: z.string(), patch: z.object({ email: z.string().email().optional(), name: z.string().optional(), signatureId: z.string().nullable().optional(), replyTo: z.string().nullable().optional(), isDefault: z.boolean().optional() }) }),
    z.void()
  ),
  'identities.remove': defineChannel(z.object({ id: z.string() }), z.void()),
  'signatures.list': defineChannel(z.void(), z.array(SignatureSchema)),
  'signatures.save': defineChannel(z.object({ id: z.string().optional(), name: z.string(), html: z.string(), text: z.string() }), SignatureSchema),
  'signatures.delete': defineChannel(z.object({ id: z.string() }), z.void()),

  // ---- search / contacts / rules / snooze ----------------------------------
  'search.run': defineChannel(z.object({ query: z.string(), accountId: z.string().optional(), folderId: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), z.array(MessageListItemSchema)),
  'search.saved.list': defineChannel(z.void(), SavedSearchesSchema),
  'search.saved.set': defineChannel(SavedSearchesSchema, z.void()),
  'contacts.list': defineChannel(z.void(), z.array(ContactSchema)),
  'contacts.suggest': defineChannel(z.object({ prefix: z.string(), limit: z.number().int().optional() }), z.array(z.object({ id: z.string(), name: z.string(), address: z.string(), score: z.number() }))),
  'contacts.save': defineChannel(z.object({ id: z.string().optional(), name: z.string(), emails: z.array(z.string()), notes: z.string().nullable().optional() }), ContactSchema),
  'contacts.remove': defineChannel(z.object({ id: z.string() }), z.void()),
  'contacts.merge': defineChannel(z.object({ ids: z.array(z.string()).min(2) }), ContactSchema.nullable()),
  'contacts.duplicates': defineChannel(z.void(), z.array(z.array(ContactSchema))),
  'contacts.import': defineChannel(z.void(), z.object({ imported: z.number() })),
  'contacts.export': defineChannel(z.void(), z.object({ ok: z.boolean(), path: z.string().optional() })),
  'rules.list': defineChannel(z.void(), z.array(RuleSchema)),
  'rules.save': defineChannel(RuleInputSchema, RuleSchema),
  'rules.remove': defineChannel(z.object({ id: z.string() }), z.void()),
  'rules.reorder': defineChannel(z.object({ ids: z.array(z.string()) }), z.void()),
  'rules.applyNow': defineChannel(z.object({ folderId: z.string().optional(), ruleId: z.string().optional() }), z.object({ affected: z.number() })),
  'messages.snooze': defineChannel(z.object({ ids: z.array(z.string()).min(1), until: z.string() }), z.void()),
  'messages.unsnooze': defineChannel(z.object({ ids: z.array(z.string()).min(1) }), z.void())
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
  'messages.bodyFetched': z.object({ id: z.string() }),
  'outbox.changed': z.void(),
  'outbox.sent': z.object({ id: z.string() }),
  'outbox.failed': z.object({ id: z.string(), error: z.string() }),
  'rules.changed': z.void(),
  'snooze.woke': z.object({ ids: z.array(z.string()) })
} as const

export type Events = typeof events
export type EventName = keyof Events
export type EventPayload<E extends EventName> = z.output<Events[E]>

export const channelNames = Object.keys(channels) as ChannelName[]
export const eventNames = Object.keys(events) as EventName[]
