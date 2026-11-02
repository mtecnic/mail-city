import { app, BrowserWindow, Menu, Tray, nativeImage, type NativeImage } from 'electron'
import { join } from 'node:path'
import type { Kernel } from '@kernel/index'
import { emit } from './ipc/router'

let tray: Tray | null = null
let lastUnread = -1

const resources = () => (app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources'))

function icon(name: string): NativeImage {
  return nativeImage.createFromPath(join(resources(), name))
}

/** Badge overlay: a red circle with the count, drawn as a tiny PNG via nativeImage from an SVG data URL. */
function overlayFor(count: number): NativeImage {
  const text = count > 99 ? '99+' : String(count)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#dc2626"/><text x="16" y="21" font-family="Segoe UI, Arial" font-size="${text.length > 2 ? 13 : 16}" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

export function showMainWindow(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows()[0] ?? null
  if (!win) return null
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  return win
}

export function createTray(kernel: Kernel, actions: { compose: () => void; openSettings: () => void }): Tray {
  tray = new Tray(icon('tray.png'))
  tray.setToolTip('Mail City')
  const menu = Menu.buildFromTemplate([
    { label: 'Open Mail City', click: () => showMainWindow() },
    { label: 'New message', click: () => actions.compose() },
    { type: 'separator' },
    { label: 'Sync all accounts now', click: () => kernel.sync.syncNow() },
    { label: 'Settings…', click: () => actions.openSettings() },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win?.isVisible() && win.isFocused()) win.hide()
    else showMainWindow()
  })
  tray.on('double-click', () => showMainWindow())
  return tray
}

export function updateUnreadBadge(kernel: Kernel): void {
  const unread = kernel.store.unreadTotal()
  if (unread === lastUnread) return
  lastUnread = unread
  const win = BrowserWindow.getAllWindows()[0]
  if (process.platform === 'win32') {
    win?.setOverlayIcon(unread > 0 ? overlayFor(unread) : null, unread > 0 ? `${unread} unread messages` : '')
  } else {
    app.setBadgeCount(unread)
  }
  tray?.setImage(icon(unread > 0 ? 'tray-unread.png' : 'tray.png'))
  tray?.setToolTip(unread > 0 ? `Mail City — ${unread} unread` : 'Mail City')
  emit('unread.changed', { total: unread })
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
