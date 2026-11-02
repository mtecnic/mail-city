import { contextBridge, ipcRenderer } from 'electron'
import { channelNames, eventNames, type ChannelName, type ChannelInput, type ChannelOutput, type EventName, type EventPayload } from '@shared/ipc'

const allowedChannels = new Set<string>(channelNames)
const allowedEvents = new Set<string>(eventNames)

export interface MailApi {
  invoke<C extends ChannelName>(channel: C, ...args: ChannelInput<C> extends void ? [] : [ChannelInput<C>]): Promise<ChannelOutput<C>>
  on<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void
  platform: NodeJS.Platform
}

const api: MailApi = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel)) return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, args[0])
  },
  on(event, handler) {
    if (!allowedEvents.has(event)) throw new Error(`Unknown IPC event: ${event}`)
    const listener = (_: Electron.IpcRendererEvent, payload: unknown) => handler(payload as never)
    ipcRenderer.on(`event:${event}`, listener)
    return () => ipcRenderer.off(`event:${event}`, listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('mail', api)
