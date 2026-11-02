import { contextBridge, ipcRenderer } from 'electron'
import type { ChannelName, ChannelInput, ChannelOutput, EventName, EventPayload } from '@shared/ipc'

/**
 * The bridge is intentionally dependency-free (sandboxed preloads can only
 * `require` Electron built-ins). Channel validation happens in the main
 * process: unknown channels have no handler and reject.
 */
export interface MailApi {
  invoke<C extends ChannelName>(channel: C, ...args: ChannelInput<C> extends void ? [] : [ChannelInput<C>]): Promise<ChannelOutput<C>>
  on<E extends EventName>(event: E, handler: (payload: EventPayload<E>) => void): () => void
  platform: NodeJS.Platform
}

const api: MailApi = {
  invoke(channel, ...args) {
    if (typeof channel !== 'string' || !/^[a-zA-Z][\w.]{1,80}$/.test(channel)) return Promise.reject(new Error(`Invalid IPC channel: ${String(channel)}`))
    return ipcRenderer.invoke(channel, args[0])
  },
  on(event, handler) {
    if (typeof event !== 'string' || !/^[a-zA-Z][\w.]{1,80}$/.test(event)) throw new Error(`Invalid IPC event: ${String(event)}`)
    const listener = (_: Electron.IpcRendererEvent, payload: unknown) => handler(payload as never)
    ipcRenderer.on(`event:${event}`, listener)
    return () => ipcRenderer.off(`event:${event}`, listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('mail', api)
