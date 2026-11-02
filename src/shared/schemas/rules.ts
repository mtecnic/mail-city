import { z } from 'zod'

export const RuleFieldSchema = z.enum(['from', 'to', 'cc', 'anyRecipient', 'subject', 'body', 'listId', 'hasAttachment', 'size', 'aiCategory', 'anyHeader'])
export const RuleOpSchema = z.enum(['contains', 'notContains', 'equals', 'startsWith', 'endsWith', 'regex', 'isTrue', 'isFalse', 'gt', 'lt'])

export const RuleConditionSchema = z.object({
  field: RuleFieldSchema,
  op: RuleOpSchema,
  value: z.string().default('')
})
export type RuleCondition = z.output<typeof RuleConditionSchema>

export const RuleConditionsSchema = z.object({
  match: z.enum(['all', 'any']).default('all'),
  items: z.array(RuleConditionSchema).default([])
})
export type RuleConditions = z.output<typeof RuleConditionsSchema>

export const RuleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), folderId: z.string() }),
  z.object({ type: z.literal('archive') }),
  z.object({ type: z.literal('delete') }),
  z.object({ type: z.literal('junk') }),
  z.object({ type: z.literal('markRead') }),
  z.object({ type: z.literal('flag') }),
  z.object({ type: z.literal('mute') }), // no notification
  z.object({ type: z.literal('setCategory'), category: z.string() }),
  z.object({ type: z.literal('forward'), to: z.string().email() })
])
export type RuleAction = z.output<typeof RuleActionSchema>

export const RuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  sortOrder: z.number(),
  accountIds: z.array(z.string()),
  conditions: RuleConditionsSchema,
  actions: z.array(RuleActionSchema),
  stopProcessing: z.boolean(),
  createdAt: z.string()
})
export type Rule = z.output<typeof RuleSchema>

export const RuleInputSchema = RuleSchema.partial({ id: true, sortOrder: true, createdAt: true, enabled: true, stopProcessing: true, accountIds: true })
export type RuleInput = z.input<typeof RuleInputSchema>
