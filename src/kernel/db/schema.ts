/**
 * Drizzle schema. Must stay in sync with the SQL in `migrations.ts` — the SQL is
 * the source of truth at runtime (we don't run drizzle-kit in the packaged app);
 * this file gives us typed queries.
 */
import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // gmail|outlook|icloud|yahoo|imap
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  imapHost: text('imap_host').notNull(),
  imapPort: integer('imap_port').notNull(),
  imapTls: text('imap_tls').notNull(), // tls|starttls|none
  smtpHost: text('smtp_host').notNull(),
  smtpPort: integer('smtp_port').notNull(),
  smtpTls: text('smtp_tls').notNull(),
  authType: text('auth_type').notNull(), // oauth2|password
  oauthProvider: text('oauth_provider'), // google|microsoft
  color: text('color').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  syncSettings: json<Record<string, unknown>>('sync_settings').notNull().default({}),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull()
})

export const secrets = sqliteTable(
  'secrets',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // password|refresh_token|access_token|oauth_meta
    ciphertext: text('ciphertext').notNull(), // base64 of safeStorage.encryptString
    expiresAt: text('expires_at'),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.accountId, t.kind] })]
)

export const identities = sqliteTable('identities', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  name: text('name').notNull(),
  signatureId: text('signature_id'),
  replyTo: text('reply_to'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false)
})

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    delimiter: text('delimiter'),
    specialUse: text('special_use'), // inbox|sent|drafts|trash|junk|archive|all|flagged
    uidValidity: integer('uid_validity'),
    uidNext: integer('uid_next'),
    highestModSeq: text('highest_mod_seq'),
    unreadCount: integer('unread_count').notNull().default(0),
    totalCount: integer('total_count').notNull().default(0),
    subscribed: integer('subscribed', { mode: 'boolean' }).notNull().default(true),
    syncEnabled: integer('sync_enabled', { mode: 'boolean' }).notNull().default(true),
    lastSyncAt: text('last_sync_at'),
    sortOrder: integer('sort_order').notNull().default(0)
  },
  (t) => [uniqueIndex('folders_account_path').on(t.accountId, t.path)]
)

export interface Address {
  name: string
  address: string
}

export interface MessageFlags {
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  deleted: boolean
  forwarded?: boolean
}

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    uid: integer('uid').notNull(),
    messageId: text('message_id'),
    threadId: text('thread_id'),
    gmThreadId: text('gm_thread_id'),
    inReplyTo: text('in_reply_to'),
    references: json<string[]>('references_json').notNull().default([]),
    subject: text('subject').notNull().default(''),
    fromName: text('from_name').notNull().default(''),
    fromAddr: text('from_addr').notNull().default(''),
    toList: json<Address[]>('to_json').notNull().default([]),
    ccList: json<Address[]>('cc_json').notNull().default([]),
    bccList: json<Address[]>('bcc_json').notNull().default([]),
    replyTo: json<Address[]>('reply_to_json').notNull().default([]),
    date: text('date').notNull(),
    internalDate: text('internal_date').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    flags: json<MessageFlags>('flags_json').notNull(),
    labels: json<string[]>('labels_json').notNull().default([]),
    snippet: text('snippet').notNull().default(''),
    hasAttachments: integer('has_attachments', { mode: 'boolean' }).notNull().default(false),
    bodyState: text('body_state').notNull().default('headers'), // headers|full
    listUnsubscribe: text('list_unsubscribe'),
    listId: text('list_id'),
    aiCategory: text('ai_category'),
    aiPriority: integer('ai_priority'),
    aiSummary: text('ai_summary'),
    indexState: text('index_state').notNull().default('none'), // none|fts|vec
    snoozedUntil: text('snoozed_until'),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    uniqueIndex('messages_account_folder_uid').on(t.accountId, t.folderId, t.uid),
    index('messages_thread').on(t.threadId),
    index('messages_date').on(t.date),
    index('messages_folder_date').on(t.folderId, t.date),
    index('messages_message_id').on(t.messageId)
  ]
)

export const messageBodies = sqliteTable('message_bodies', {
  messageId: text('message_id')
    .primaryKey()
    .references(() => messages.id, { onDelete: 'cascade' }),
  textPlain: text('text_plain'),
  textHtml: text('text_html'),
  rawPath: text('raw_path'),
  headers: json<Record<string, string>>('headers_json'),
  fetchedAt: text('fetched_at').notNull()
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id')
    .notNull()
    .references(() => messages.id, { onDelete: 'cascade' }),
  part: text('part'),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull().default(0),
  contentId: text('content_id'),
  isInline: integer('is_inline', { mode: 'boolean' }).notNull().default(false),
  localPath: text('local_path')
})

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    subjectNormalized: text('subject_normalized').notNull(),
    lastDate: text('last_date').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    participants: json<Address[]>('participants_json').notNull().default([])
  },
  (t) => [index('threads_account_date').on(t.accountId, t.lastDate)]
)

export const contacts = sqliteTable('contacts', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  emails: json<string[]>('emails_json').notNull(),
  primaryEmail: text('primary_email').notNull().unique(),
  lastSeenAt: text('last_seen_at'),
  sendCount: integer('send_count').notNull().default(0),
  receiveCount: integer('receive_count').notNull().default(0),
  source: text('source').notNull().default('harvested'), // harvested|manual|vcard
  notes: text('notes'),
  avatarPath: text('avatar_path')
})

export const signatures = sqliteTable('signatures', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  html: text('html').notNull(),
  text: text('text').notNull()
})

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  accountIds: json<string[]>('account_ids_json').notNull().default([]),
  conditions: json<unknown>('conditions_json').notNull(),
  actions: json<unknown[]>('actions_json').notNull(),
  stopProcessing: integer('stop_processing', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull()
})

export const outbox = sqliteTable('outbox', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  identityId: text('identity_id'),
  mimePath: text('mime_path').notNull(),
  envelope: json<{ from: string; to: string[] }>('envelope_json').notNull(),
  subject: text('subject').notNull().default(''),
  status: text('status').notNull().default('queued'), // queued|sending|sent|failed|cancelled
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  scheduledAt: text('scheduled_at'),
  undoUntil: text('undo_until'),
  inReplyToMessageId: text('in_reply_to_message_id'),
  createdAt: text('created_at').notNull()
})

export const pendingOps = sqliteTable(
  'pending_ops',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // setFlags|move|delete|append|...
    payload: json<unknown>('payload_json').notNull(),
    status: text('status').notNull().default('queued'), // queued|running|failed
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('pending_ops_account').on(t.accountId, t.createdAt)]
)

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: text('account_id').notNull(),
  folderPath: text('folder_path'),
  kind: text('kind').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  detail: text('detail'),
  durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull()
})

export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey(),
  feature: text('feature').notNull(),
  providerId: text('provider_id').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: text('cost_usd'),
  durationMs: integer('duration_ms'),
  messageIds: json<string[]>('message_ids_json').notNull().default([]),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull()
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value_json').notNull(),
  updatedAt: text('updated_at').notNull()
})

export type AccountRow = typeof accounts.$inferSelect
export type FolderRow = typeof folders.$inferSelect
export type MessageRow = typeof messages.$inferSelect
export type MessageBodyRow = typeof messageBodies.$inferSelect
export type AttachmentRow = typeof attachments.$inferSelect
export type ContactRow = typeof contacts.$inferSelect
export type RuleRow = typeof rules.$inferSelect
export type OutboxRow = typeof outbox.$inferSelect
export type PendingOpRow = typeof pendingOps.$inferSelect
