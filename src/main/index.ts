import { app, BrowserWindow, safeStorage, shell, powerMonitor } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import log from 'electron-log/main'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { Kernel } from '@kernel/index'
import { setLogSink } from '@kernel/utils/logger'
import { createMainWindow } from './windows/main'
import { registerIpc } from './ipc'
import { emit } from './ipc/router'
import { electronCipher } from './cipher'
import { createTray, destroyTray, showMainWindow, updateUnreadBadge } from './tray'
import { installNotifications } from './notifications'
import { registerProtocol, handleArgv, installJumpList, applyLoginItem } from './protocol'
import { installUpdater } from './updater'
import { runMcpStdio } from './mcpStdio'
import { McpHttpServer } from './mcpHttp'
import { getMcpSettings } from '@kernel/ai/mcp/McpBridge'
import { setMcpHttp, getMcpHttp } from './ipc'

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

// ---- profile override (tests, portable installs) ---------------------------
const userDataArg = process.argv.find((a) => a.startsWith('--user-data-dir='))
if (userDataArg) app.setPath('userData', userDataArg.slice('--user-data-dir='.length))

// ---- headless MCP mode -----------------------------------------------------
if (process.argv.includes('--mcp')) {
  void runMcpStdio().catch((e) => {
    process.stderr.write(`mcp stdio failed: ${e instanceof Error ? e.message : String(e)}\n`)
    app.exit(1)
  })
}
// ---- single instance -----------------------------------------------------
else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    if (!handleArgv(argv)) showMainWindow()
  })

  app.setAppUserModelId('com.mtecnic.mailcity')
  registerProtocol()

  let kernel: Kernel | null = null

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.mtecnic.mailcity')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const dataDir = join(app.getPath('userData'), 'data')
    mkdirSync(dataDir, { recursive: true })

    kernel = new Kernel({
      dataDir,
      cipher: electronCipher(safeStorage),
      openUrl: (url) => shell.openExternal(url),
      oauthDefaults: {
        googleClientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
        googleClientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
        microsoftClientId: import.meta.env.MAIN_VITE_MS_CLIENT_ID
      }
    })
    registerIpc(kernel)
    const mcp = new McpHttpServer(kernel)
    setMcpHttp(mcp)
    if (getMcpSettings(kernel).httpEnabled) mcp.start().catch((e) => log.warn('MCP HTTP failed to start', e))
    installNotifications(kernel)
    installJumpList()
    installUpdater()
    applyLoginItem(kernel.settings.get().launchAtLogin)
    kernel.settings.on('changed', (s) => applyLoginItem(s.launchAtLogin))

    const hidden = process.argv.includes('--hidden')
    createMainWindow(kernel, { hidden })
    createTray(kernel, {
      compose: () => {
        showMainWindow()
        emit('app.compose', undefined)
      },
      openSettings: () => {
        showMainWindow()
        emit('app.openSettings', undefined)
      }
    })

    const k = kernel
    const badge = () => updateUnreadBadge(k)
    k.sync.on('messagesChanged', badge)
    k.sync.on('foldersChanged', badge)
    k.rules.on('applied', badge)
    k.snooze.on('woke', badge)
    setTimeout(badge, 2000)

    powerMonitor.on('resume', () => k.sync.syncNow())
    powerMonitor.on('unlock-screen', () => k.sync.syncNow())

    // mailto: on cold start (Windows passes it in argv).
    setTimeout(() => handleArgv(process.argv), 1500)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(k)
      else showMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    ;(app as typeof app & { isQuitting?: boolean }).isQuitting = true
    destroyTray()
  })

  app.on('will-quit', (e) => {
    if (!kernel) return
    const k = kernel
    kernel = null
    e.preventDefault()
    // Give the outbox/sync a moment to flush, then really quit.
    Promise.race([Promise.all([k.shutdown(), getMcpHttp()?.stop()]), new Promise((r) => setTimeout(r, 3000))]).finally(() => app.quit())
  })
}
