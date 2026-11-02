import { app, shell, dialog, BrowserWindow } from 'electron'
import { readFile, copyFile } from 'node:fs/promises'
import type { Kernel } from '@kernel/index'
import type { AppSettingsPatch } from '@shared/schemas/settings'
import { handle, emit } from './router'

const DANGEROUS_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|pif)$/i

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

  // ---- mail --------------------------------------------------------------
  handle('folders.list', ({ accountId }) => kernel.store.listFolders(accountId))
  handle('folders.sync', ({ accountId, folderId }) => kernel.sync.requestFolderSync(accountId, folderId))

  handle('messages.list', (q) => kernel.mail.list(q))
  handle('messages.thread', ({ threadId }) => kernel.mail.thread(threadId))
  handle('messages.get', ({ id, fetchBody }) => kernel.mail.get(id, { fetchBody }))
  handle('messages.setFlags', ({ ids, flags }) => kernel.mail.setFlags(ids, flags))
  handle('messages.move', ({ ids, toFolderId }) => kernel.mail.move(ids, toFolderId))
  handle('messages.archive', ({ ids }) => kernel.mail.archive(ids))
  handle('messages.delete', ({ ids }) => kernel.mail.delete(ids))
  handle('messages.junk', ({ ids, junk }) => kernel.mail.markJunk(ids, junk))
  handle('messages.unreadCount', ({ accountId }) => kernel.store.unreadTotal(accountId))

  handle('attachments.open', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a) return { ok: false, error: 'Attachment is not available' }
    if (DANGEROUS_EXT.test(a.filename)) {
      const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Cancel', 'Open anyway'], defaultId: 0, cancelId: 0, message: `"${a.filename}" is an executable file`, detail: 'Files of this type can harm your computer. Only open it if you trust the sender.' })
      if (r.response !== 1) return { ok: false }
    }
    const err = await shell.openPath(a.path)
    return err ? { ok: false, error: err } : { ok: true }
  })
  handle('attachments.saveAs', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a) return { ok: false }
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const r = await dialog.showSaveDialog(win as never, { defaultPath: a.filename })
    if (r.canceled || !r.filePath) return { ok: false }
    await copyFile(a.path, r.filePath)
    return { ok: true, path: r.filePath }
  })
  handle('attachments.dataUrl', async ({ id }) => {
    const a = await kernel.mail.attachmentPath(id)
    if (!a || !/^image\//.test(a.mimeType)) return null
    const buf = await readFile(a.path)
    if (buf.length > 15 * 1024 * 1024) return null
    return `data:${a.mimeType};base64,${buf.toString('base64')}`
  })

  handle('sync.now', ({ accountId }) => kernel.sync.syncNow(accountId))

  kernel.sync.on('status', (accountId, state, detail) => emit('sync.status', { accountId, state, detail }))
  kernel.sync.on('foldersChanged', (accountId) => emit('folders.changed', { accountId }))
  kernel.sync.on('messagesChanged', (accountId, folderId) => emit('messages.changed', { accountId, folderId }))
  kernel.sync.on('newMessages', (accountId, folderId, ids) => emit('messages.new', { accountId, folderId, ids }))
  kernel.sync.on('bodyFetched', (id) => emit('messages.bodyFetched', { id }))
}
