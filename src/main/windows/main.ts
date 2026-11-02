import { app, BrowserWindow, shell, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'node:path'
import type { Kernel } from '@kernel/index'

const BOUNDS_KEY = 'windowBounds'

export function createMainWindow(kernel: Kernel, opts: { hidden?: boolean } = {}): BrowserWindow {
  const saved = kernel.settings.getValue(BOUNDS_KEY, boundsSchema)
  const win = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'Mail City',
    icon: app.isPackaged ? join(process.resourcesPath, 'resources', 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: true
    }
  })
  if (saved?.maximized) win.maximize()

  // Make sure a remembered position is still on a connected display.
  if (saved && !screen.getAllDisplays().some((d) => saved.x! >= d.bounds.x - 50 && saved.x! < d.bounds.x + d.bounds.width && saved.y! >= d.bounds.y - 50 && saved.y! < d.bounds.y + d.bounds.height)) {
    win.center()
  }

  win.on('ready-to-show', () => {
    if (!opts.hidden) win.show()
  })

  const persistBounds = () => {
    if (win.isDestroyed()) return
    const b = win.getNormalBounds()
    kernel.settings.setValue(BOUNDS_KEY, { ...b, maximized: win.isMaximized() })
  }
  win.on('resize', debounce(persistBounds, 500))
  win.on('move', debounce(persistBounds, 500))
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)

  // Close → hide to tray unless quitting or the setting is off.
  win.on('close', (e) => {
    const quitting = (app as typeof app & { isQuitting?: boolean }).isQuitting
    if (!quitting && kernel.settings.get().minimizeToTray && process.platform !== 'darwin') {
      e.preventDefault()
      win.hide()
    }
  })

  // Any navigation or new window request goes to the OS browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
    if (!url.startsWith(devUrl || 'file://')) {
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

import { z } from 'zod'
const boundsSchema = z
  .object({ x: z.number().optional(), y: z.number().optional(), width: z.number(), height: z.number(), maximized: z.boolean().optional() })
  .optional()

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: NodeJS.Timeout | null = null
  return ((...args: never[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}
