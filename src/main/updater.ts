import { app } from 'electron'
import updater from 'electron-updater'
// electron-updater is CommonJS; the main bundle is ESM, so pull the named export off the default.
const { autoUpdater } = updater
import log from 'electron-log/main'
import { emit } from './ipc/router'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let status: UpdateStatus = { state: 'idle' }
function set(s: UpdateStatus) {
  status = s
  emit('update.status', s)
}

export function currentUpdateStatus(): UpdateStatus {
  return status
}

export function installUpdater(): void {
  if (!app.isPackaged) return
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'idle' }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'downloaded', version: info.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', message: e.message }))
  setTimeout(() => void checkForUpdates(), 15_000)
  setInterval(() => void checkForUpdates(), 6 * 3600_000)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function installUpdateNow(): void {
  ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
  autoUpdater.quitAndInstall()
}
