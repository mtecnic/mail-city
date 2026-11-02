import { app, shell } from 'electron'
import type { Kernel } from '@kernel/index'
import type { AppSettingsPatch } from '@shared/schemas/settings'
import { handle, emit } from './router'

export function registerIpc(kernel: Kernel): void {
  handle('app.version', () => ({ version: app.getVersion(), electron: process.versions.electron ?? '' }))
  handle('app.openExternal', async ({ url }) => {
    if (!/^https?:/i.test(url)) throw new Error('Only http(s) URLs can be opened')
    await shell.openExternal(url)
  })

  handle('settings.get', () => kernel.settings.get())
  handle('settings.set', (patch) => kernel.settings.set(patch as AppSettingsPatch))
  kernel.settings.on('changed', (s) => emit('settings.changed', s))

  handle('accounts.list', () => kernel.accounts.list())
}
