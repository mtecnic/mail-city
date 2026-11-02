import { z } from 'zod'
import { AddressSchema } from './mail'

export const DraftAttachmentSchema = z.object({
  path: z.string(),
  filename: z.string(),
  size: z.number(),
  mimeType: z.string(),
  cid: z.string().optional()
})
export type DraftAttachment = z.output<typeof DraftAttachmentSchema>

export const ReplyModeSchema = z.enum(['reply', 'replyAll', 'forward'])
export type ReplyMode = z.output<typeof ReplyModeSchema>

export const DraftInputSchema = z.object({
  id: z.string().optional(),
  accountId: z.string(),
  identityId: z.string().nullable().optional(),
  to: z.array(AddressSchema).default([]),
  cc: z.array(AddressSchema).default([]),
  bcc: z.array(AddressSchema).default([]),
  subject: z.string().default(''),
  html: z.string().default(''),
  text: z.string().default(''),
  attachments: z.array(DraftAttachmentSchema).default([]),
  inReplyToMessageId: z.string().nullable().optional(),
  replyMode: ReplyModeSchema.nullable().optional()
})
export type DraftInput = z.input<typeof DraftInputSchema>

export const DraftSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  identityId: z.string().nullable(),
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  bcc: z.array(AddressSchema),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  attachments: z.array(DraftAttachmentSchema),
  inReplyToMessageId: z.string().nullable(),
  replyMode: ReplyModeSchema.nullable(),
  updatedAt: z.string(),
  createdAt: z.string()
})
export type Draft = z.output<typeof DraftSchema>

export const IdentitySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  email: z.string(),
  name: z.string(),
  signatureId: z.string().nullable(),
  replyTo: z.string().nullable(),
  isDefault: z.boolean()
})
export type Identity = z.output<typeof IdentitySchema>

export const SignatureSchema = z.object({ id: z.string(), name: z.string(), html: z.string(), text: z.string() })
export type Signature = z.output<typeof SignatureSchema>

export const OutboxItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  subject: z.string(),
  to: z.array(z.string()),
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'cancelled']),
  attempts: z.number(),
  lastError: z.string().nullable(),
  scheduledAt: z.string().nullable(),
  undoUntil: z.string().nullable(),
  createdAt: z.string()
})
export type OutboxItem = z.output<typeof OutboxItemSchema>

/** Pre-filled fields for a reply/forward composer. */
export const ReplyTemplateSchema = z.object({
  accountId: z.string(),
  identityId: z.string().nullable(),
  to: z.array(AddressSchema),
  cc: z.array(AddressSchema),
  subject: z.string(),
  quotedHtml: z.string(),
  quotedText: z.string(),
  attachments: z.array(DraftAttachmentSchema),
  inReplyToMessageId: z.string(),
  replyMode: ReplyModeSchema
})
export type ReplyTemplate = z.output<typeof ReplyTemplateSchema>
