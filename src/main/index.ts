import { app, BrowserWindow, safeStorage } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Kernel } from '@kernel/index'
import { setLogSink } from '@kernel/utils/logger'
import { createMainWindow } from './windows/main'
import { registerIpc } from './ipc'
import { electronCipher } from './cipher'

// ---- logging -------------------------------------------------------------
log.initialize()
log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
setLogSink({
  log(level, scope, message, meta) {
    const scoped = log.scope(scope)
    if (meta === undefined) scoped[level](message)
    else scoped[level](message, meta)
  }
})

// ---- single instance -----------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    const mailto = argv.find((a) => a.startsWith('mailto:'))
    if (mailto) win?.webContents.send('event:mailto', mailto)
  })

  app.setAppUserModelId('com.mtecnic.mailcity')
  if (process.defaultApp) {
    if (process.argv[1]) app.setAsDefaultProtocolClient('mailto', process.execPath, [join(process.cwd(), process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('mailto')
  }

  let kernel: Kernel | null = null

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.mtecnic.mailcity')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const dataDir = join(app.getPath('userData'), 'data')
    mkdirSync(dataDir, { recursive: true })

    kernel = new Kernel({ dataDir, cipher: electronCipher(safeStorage) })
    registerIpc(kernel)

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', async () => {
    await kernel?.shutdown()
  })
}
