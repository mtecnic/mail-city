/**
 * Shared menu builders for accounts, folders and messages so the sidebar,
 * list, reading pane and keyboard shortcuts all offer the same actions.
 */
import { invoke } from '@renderer/lib/api'
import type { MenuItem } from '@renderer/components/ContextMenu'
import { promptDialog, confirmDialog, colorDialog } from '@renderer/components/dialogs'
import type { Folder, MessageListItem } from '@shared/schemas/mail'
import type { AccountSummary } from '@shared/schemas/account'

export interface MessageMenuDeps {
  folders: Folder[]
  actions: {
    setFlags: (v: { ids: string[]; flags: Record<string, boolean> }) => void
    archive: (ids: string[]) => void
    del: (ids: string[]) => void
    move: (v: { ids: string[]; toFolderId: string }) => void
    junk: (v: { ids: string[]; junk: boolean }) => void
  }
  reply: (id: string, mode: 'reply' | 'replyAll' | 'forward') => void
  snooze: (ids: string[], until: Date) => void
  viewSource: (id: string) => void
  open: (id: string) => void
}

export function snoozePresets(): [string, Date][] {
  const d = () => new Date()
  const later = d(); later.setHours(later.getHours() + 3, 0, 0, 0)
  const tomorrow = d(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0)
  const weekend = d(); weekend.setDate(weekend.getDate() + ((6 - weekend.getDay() + 7) % 7 || 7)); weekend.setHours(8, 0, 0, 0)
  const nextWeek = d(); nextWeek.setDate(nextWeek.getDate() + ((1 - nextWeek.getDay() + 7) % 7 || 7)); nextWeek.setHours(8, 0, 0, 0)
  return [['Later today', later], ['Tomorrow', tomorrow], ['This weekend', weekend], ['Next week', nextWeek]]
}

export function messageMenu(selected: MessageListItem[], deps: MessageMenuDeps): MenuItem[] {
  if (!selected.length) return []
  const ids = selected.map((m) => m.id)
  const one = selected.length === 1 ? selected[0]! : null
  const allSeen = selected.every((m) => m.flags.seen)
  const allFlagged = selected.every((m) => m.flags.flagged)
  const accountId = selected[0]!.accountId
  const sameAccount = selected.every((m) => m.accountId === accountId)
  const inJunk = selected.every((m) => deps.folders.find((f) => f.id === m.folderId)?.specialUse === 'junk')
  const moveTargets = deps.folders
    .filter((f) => f.accountId === accountId && !selected.some((m) => m.folderId === f.id))
    .map<MenuItem>((f) => ({ label: f.path, onSelect: () => deps.actions.move({ ids, toFolderId: f.id }) }))
  return [
    ...(one
      ? [
          { label: 'Open', onSelect: () => deps.open(one.id) },
          { label: 'Reply', shortcut: 'r', onSelect: () => deps.reply(one.id, 'reply') },
          { label: 'Reply all', shortcut: 'a', onSelect: () => deps.reply(one.id, 'replyAll') },
          { label: 'Forward', shortcut: 'f', onSelect: () => deps.reply(one.id, 'forward') },
          { type: 'separator' as const }
        ]
      : [{ type: 'label' as const, label: `${selected.length} messages` }]),
    { label: allSeen ? 'Mark as unread' : 'Mark as read', shortcut: 'u', onSelect: () => deps.actions.setFlags({ ids, flags: { seen: !allSeen } }) },
    { label: allFlagged ? 'Remove star' : 'Star', shortcut: 's', onSelect: () => deps.actions.setFlags({ ids, flags: { flagged: !allFlagged } }) },
    { type: 'separator' },
    { label: 'Archive', shortcut: 'e', onSelect: () => deps.actions.archive(ids) },
    { label: 'Move to…', shortcut: 'v', disabled: !sameAccount || !moveTargets.length, submenu: moveTargets },
    { label: 'Snooze…', shortcut: 'z', submenu: snoozePresets().map(([label, when]) => ({ label: `${label} · ${when.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, onSelect: () => deps.snooze(ids, when) })) },
    inJunk ? { label: 'Not junk', onSelect: () => deps.actions.junk({ ids, junk: false }) } : { label: 'Mark as junk', shortcut: '!', onSelect: () => deps.actions.junk({ ids, junk: true }) },
    { type: 'separator' },
    ...(one
      ? [
          { label: 'Copy link', onSelect: () => void navigator.clipboard.writeText(`mail://msg/${one.id}`) },
          { label: 'View source…', onSelect: () => deps.viewSource(one.id) },
          { type: 'separator' as const }
        ]
      : []),
    { label: 'Delete', shortcut: '#', danger: true, onSelect: () => deps.actions.del(ids) }
  ]
}

export interface FolderMenuDeps {
  open: () => void
  refresh: () => void
}

export function folderMenu(f: Folder, deps: FolderMenuDeps): MenuItem[] {
  const system = !!f.specialUse && ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all'].includes(f.specialUse)
  const run = (p: Promise<unknown>) => p.then(deps.refresh).catch((e) => confirmDialog({ title: 'Folder action failed', message: String(e?.message ?? e), okLabel: 'OK' }))
  return [
    { label: 'Open', onSelect: deps.open },
    { label: 'Sync now', onSelect: () => void run(invoke('folders.sync', { accountId: f.accountId, folderId: f.id })) },
    { label: 'Mark all as read', disabled: !f.unreadCount, onSelect: () => void run(invoke('folders.markAllRead', { id: f.id })) },
    { type: 'separator' },
    {
      label: 'New subfolder…',
      onSelect: async () => {
        const name = await promptDialog({ title: 'New folder', label: `Inside ${f.path}`, okLabel: 'Create' })
        if (name) void run(invoke('folders.create', { accountId: f.accountId, name, parentId: f.id }))
      }
    },
    {
      label: 'Rename…',
      disabled: system,
      onSelect: async () => {
        const name = await promptDialog({ title: 'Rename folder', defaultValue: f.name, okLabel: 'Rename' })
        if (name && name !== f.name) void run(invoke('folders.rename', { id: f.id, name }))
      }
    },
    ...(f.specialUse === 'trash' || f.specialUse === 'junk'
      ? [
          {
            label: f.specialUse === 'trash' ? 'Empty Trash' : 'Empty Junk',
            danger: true,
            disabled: !f.totalCount,
            onSelect: async () => {
              if (await confirmDialog({ title: `Empty ${f.name}?`, message: `Permanently delete ${f.totalCount} message${f.totalCount === 1 ? '' : 's'}. This cannot be undone.`, okLabel: 'Empty', danger: true })) void run(invoke('folders.empty', { id: f.id }))
            }
          }
        ]
      : []),
    {
      label: 'Delete folder…',
      danger: true,
      disabled: system,
      onSelect: async () => {
        if (await confirmDialog({ title: `Delete "${f.path}"?`, message: 'The folder and its messages are removed from the server.', okLabel: 'Delete', danger: true })) void run(invoke('folders.delete', { id: f.id }))
      }
    }
  ]
}

export interface AccountMenuDeps {
  accounts: AccountSummary[]
  inbox?: Folder
  refresh: () => void
  openSettings: (tab?: 'general' | 'servers' | 'signin') => void
}

export function accountMenu(a: AccountSummary, deps: AccountMenuDeps): MenuItem[] {
  const ids = deps.accounts.map((x) => x.id)
  const idx = ids.indexOf(a.id)
  const run = (p: Promise<unknown>) => p.then(deps.refresh)
  return [
    ...(a.lastError ? [{ label: 'Fix sign-in…', danger: true, onSelect: () => deps.openSettings('signin') }, { type: 'separator' as const }] : []),
    {
      label: 'Rename…',
      onSelect: async () => {
        const name = await promptDialog({ title: 'Rename account', defaultValue: a.displayName, okLabel: 'Rename' })
        if (name && name !== a.displayName) void run(invoke('accounts.update', { id: a.id, patch: { displayName: name } }))
      }
    },
    {
      label: 'Change color…',
      onSelect: async () => {
        const c = await colorDialog('Account color', a.color)
        if (c) void run(invoke('accounts.update', { id: a.id, patch: { color: c } }))
      }
    },
    { label: 'Account settings…', onSelect: () => deps.openSettings('general') },
    { type: 'separator' },
    { label: 'Sync now', onSelect: () => void invoke('sync.now', { accountId: a.id }) },
    { label: 'Mark inbox as read', disabled: !deps.inbox?.unreadCount, onSelect: () => deps.inbox && void run(invoke('folders.markAllRead', { id: deps.inbox.id })) },
    { label: a.enabled ? 'Pause sync' : 'Resume sync', onSelect: () => void run(invoke('accounts.update', { id: a.id, patch: { enabled: !a.enabled } })) },
    { type: 'separator' },
    { label: 'Move up', disabled: idx <= 0, onSelect: () => void run(invoke('accounts.reorder', { ids: swap(ids, idx, idx - 1) })) },
    { label: 'Move down', disabled: idx < 0 || idx >= ids.length - 1, onSelect: () => void run(invoke('accounts.reorder', { ids: swap(ids, idx, idx + 1) })) },
    { type: 'separator' },
    {
      label: 'Remove account…',
      danger: true,
      onSelect: async () => {
        if (await confirmDialog({ title: `Remove ${a.email}?`, message: 'The local cache for this account is deleted. Nothing is removed from the server.', okLabel: 'Remove', danger: true })) void run(invoke('accounts.remove', { id: a.id }))
      }
    }
  ]
}

function swap(ids: string[], i: number, j: number): string[] {
  const out = [...ids]
  ;[out[i], out[j]] = [out[j]!, out[i]!]
  return out
}
