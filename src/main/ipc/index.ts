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
  handle('accounts.discover', ({ email }) => kernel.discover(email))
  handle('accounts.test', (req) => kernel.testAccount(req))
  handle('accounts.create', (req) => kernel.createAccount(req))
  handle('accounts.update', ({ id, patch }) => kernel.accounts.update(id, patch))
  handle('accounts.remove', ({ id }) => kernel.accounts.remove(id))
  kernel.accounts.on('changed', () => emit('accounts.changed', undefined))

  handle('oauth.start', ({ provider, loginHint }) => kernel.oauth.start(provider, loginHint))
  handle('oauth.config.get', () => ({ user: kernel.oauthConfig.getUserConfig(), hasGoogle: kernel.oauthConfig.hasGoogle(), hasMicrosoft: kernel.oauthConfig.hasMicrosoft() }))
  handle('oauth.config.set', (cfg) => kernel.oauthConfig.setUserConfig(cfg))
}
