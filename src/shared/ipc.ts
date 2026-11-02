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
import { AccountSummarySchema } from './schemas/account'

export function defineChannel<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(input: I, output: O) {
  return { input, output }
}

export const channels = {
  'app.version': defineChannel(z.void(), z.object({ version: z.string(), electron: z.string() })),
  'app.openExternal': defineChannel(z.object({ url: z.string().url() }), z.void()),

  'settings.get': defineChannel(z.void(), AppSettingsSchema),
  'settings.set': defineChannel(z.record(z.string(), z.unknown()), AppSettingsSchema),

  'accounts.list': defineChannel(z.void(), z.array(AccountSummarySchema))
} as const

export type Channels = typeof channels
export type ChannelName = keyof Channels
export type ChannelInput<C extends ChannelName> = z.input<Channels[C]['input']>
export type ChannelOutput<C extends ChannelName> = z.output<Channels[C]['output']>

export const events = {
  'sync.status': z.object({
    accountId: z.string(),
    state: z.enum(['idle', 'syncing', 'error', 'offline']),
    detail: z.string().optional()
  }),
  'settings.changed': AppSettingsSchema
} as const

export type Events = typeof events
export type EventName = keyof Events
export type EventPayload<E extends EventName> = z.output<Events[E]>

export const channelNames = Object.keys(channels) as ChannelName[]
export const eventNames = Object.keys(events) as EventName[]
