import { ipcMain, BrowserWindow } from 'electron'
import { channels, events, type ChannelName, type ChannelInput, type ChannelOutput, type EventName, type EventPayload } from '@shared/ipc'
import { createLogger } from '@kernel/utils/logger'

const log = createLogger('ipc')

type Handler<C extends ChannelName> = (input: ChannelInput<C>, ctx: { senderId: number }) => Promise<ChannelOutput<C>> | ChannelOutput<C>

const registered = new Set<string>()

/** Register a zod-validated request/response handler. */
export function handle<C extends ChannelName>(channel: C, handler: Handler<C>): void {
  if (registered.has(channel)) ipcMain.removeHandler(channel)
  registered.add(channel)
  const def = channels[channel]
  ipcMain.handle(channel, async (event, payload: unknown) => {
    const parsed = def.input.safeParse(payload)
    if (!parsed.success) {
      log.warn(`bad input on ${channel}`, parsed.error.issues)
      throw new Error(`Invalid input for ${channel}: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
    }
    try {
      const result = await handler(parsed.data as ChannelInput<C>, { senderId: event.sender.id })
      return def.output.parse(result)
    } catch (e) {
      log.error(`handler failed on ${channel}`, e instanceof Error ? e.message : e)
      throw e
    }
  })
}

/** Broadcast a typed event to every renderer window. */
export function emit<E extends EventName>(event: E, payload: EventPayload<E>): void {
  const data = events[event].parse(payload)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(`event:${event}`, data)
  }
}
