import { z } from 'zod'

export const AddressSchema = z.object({ name: z.string(), address: z.string() })
export type Address = z.output<typeof AddressSchema>

export const MessageFlagsSchema = z.object({
  seen: z.boolean(),
  flagged: z.boolean(),
  answered: z.boolean(),
  draft: z.boolean(),
  deleted: z.boolean(),
  forwarded: z.boolean().optional()
})
export type MessageFlags = z.output<typeof MessageFlagsSchema>

export const FolderSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  path: z.string(),
  name: z.string(),
  delimiter: z.string().nullable(),
  specialUse: z.string().nullable(),
  unreadCount: z.number(),
  totalCount: z.number(),
  sortOrder: z.number(),
  lastSyncAt: z.string().nullable()
})
export type Folder = z.output<typeof FolderSchema>

export const MessageListItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  folderId: z.string(),
  uid: z.number(),
  threadId: z.string().nullable(),
  subject: z.string(),
  from: AddressSchema,
  to: z.array(AddressSchema),
  date: z.string(),
  snippet: z.string(),
  flags: MessageFlagsSchema,
  hasAttachments: z.boolean(),
  labels: z.array(z.string()),
  aiCategory: z.string().nullable(),
  aiPriority: z.number().nullable(),
  threadCount: z.number(),
  threadUnread: z.number(),
  snoozedUntil: z.string().nullable()
})
export type MessageListItem = z.output<typeof MessageListItemSchema>

export const ListMessagesQuerySchema = z.object({
  accountId: z.string().optional(),
  folderId: z.string().optional(),
  specialUse: z.string().optional(),
  unreadOnly: z.boolean().optional(),
  flaggedOnly: z.boolean().optional(),
  before: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  threadId: z.string().optional(),
  snoozedOnly: z.boolean().optional(),
  /** AI "Focused": priority ≥ 2 or category primary/needs_reply (untriaged mail is included). */
  focusedOnly: z.boolean().optional()
})

export const AttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  contentId: z.string().nullable(),
  isInline: z.boolean(),
  available: z.boolean()
})

export const MessageDetailSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  folderId: z.string(),
  folderPath: z.string(),
  threadId: z.string().nullable(),
  subject: z.string(),
  from: AddressSchema,
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  bcc: z.array(AddressSchema),
  replyTo: z.array(AddressSchema),
  date: z.string(),
  flags: MessageFlagsSchema,
  labels: z.array(z.string()),
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  references: z.array(z.string()),
  listUnsubscribe: z.string().nullable(),
  bodyState: z.enum(['headers', 'full', 'unavailable']),
  textPlain: z.string().nullable(),
  textHtml: z.string().nullable(),
  headers: z.record(z.string(), z.string()).nullable(),
  attachments: z.array(AttachmentSchema),
  aiSummary: z.string().nullable(),
  aiExtract: z.unknown().nullable(),
  aiCategory: z.string().nullable()
})
export type MessageDetail = z.output<typeof MessageDetailSchema>
