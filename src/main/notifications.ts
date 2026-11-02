import { Notification, app } from 'electron'
import { join } from 'node:path'
import type { Kernel } from '@kernel/index'
import { emit } from './ipc/router'
import { showMainWindow } from './tray'
import { createLogger } from '@kernel/utils/logger'

const log = createLogger('notifications')

/** Messages the rules engine asked us to keep quiet about. Short-lived. */
const muted = new Map<string, number>()

export function installNotifications(kernel: Kernel): void {
  kernel.rules.on('applied', (outcomes) => {
    for (const o of outcomes) if (o.muted) muted.set(o.messageId, Date.now())
  })

  kernel.sync.on('newMessages', (accountId, folderId, ids) => {
    const settings = kernel.settings.get()
    if (!settings.notifications.enabled || !Notification.isSupported()) return
    const folder = kernel.store.getFolder(folderId)
    if (folder?.specialUse !== 'inbox') return
    // Rules run on the same event; give them a tick to mark mutes / move messages away.
    setTimeout(() => {
      const fresh = ids
        .map((id) => kernel.store.getMessage(id))
        .filter((m): m is NonNullable<typeof m> => !!m && !m.flags.seen && m.folderId === folderId && !muted.has(m.id))
      for (const [id, t] of muted) if (Date.now() - t > 60_000) muted.delete(id)
      if (!fresh.length) return
      const account = kernel.accounts.get(accountId)
      const iconPath = app.isPackaged ? join(process.resourcesPath, 'resources', 'icon-128.png') : join(app.getAppPath(), 'resources', 'icon-128.png')

      if (fresh.length === 1) {
        const m = fresh[0]!
        const n = new Notification({
          title: m.fromName || m.fromAddr,
          subtitle: account?.displayName,
          body: m.subject || '(no subject)',
          silent: !settings.notifications.sound,
          icon: iconPath
        })
        n.on('click', () => {
          showMainWindow()
          emit('app.openMessage', { id: m.id, accountId, folderId })
        })
        n.show()
      } else {
        const n = new Notification({
          title: `${fresh.length} new messages${account ? ` · ${account.displayName}` : ''}`,
          body: fresh
            .slice(0, 4)
            .map((m) => `${m.fromName || m.fromAddr}: ${m.subject || '(no subject)'}`)
            .join('\n'),
          silent: !settings.notifications.sound,
          icon: iconPath
        })
        n.on('click', () => {
          showMainWindow()
          emit('app.openMessage', { id: fresh[0]!.id, accountId, folderId })
        })
        n.show()
      }
      log.debug('notified', { count: fresh.length })
    }, 400)
  })

  kernel.outbox.on('failed', (id, error) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: 'Message could not be sent', body: error })
    n.on('click', () => {
      showMainWindow()
      emit('app.openOutbox', { id })
    })
    n.show()
  })
}
