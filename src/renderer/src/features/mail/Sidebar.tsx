import { useState, type DragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, File, Folder as FolderIcon, Inbox, Mail, PenSquare, Plus, RefreshCw, Send, Settings, Star, Trash2, AlertOctagon, Clock, AlarmClock, Search, Sparkles, Bot, MoreHorizontal, PanelLeftClose, PanelLeftOpen, GripVertical, type LucideIcon } from 'lucide-react'
import { invoke, useMailEvent } from '@renderer/lib/api'
import { Button, cn } from '@renderer/components/ui'
import { useContextMenu } from '@renderer/components/ContextMenu'
import { useUi, type MailboxSelection } from '@renderer/store/ui'
import { useFolders, useMailActions } from './hooks'
import { accountMenu, folderMenu } from './menus'
import { useOutbox } from '@renderer/features/compose/OutboxView'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import type { Folder } from '@shared/schemas/mail'
import type { MenuItem } from '@renderer/components/ContextMenu'
import { useLayout, reorder, COLLAPSED_SIDEBAR_WIDTH } from '@renderer/store/layout'

const SPECIAL_ICON: Record<string, LucideIcon> = { inbox: Inbox, sent: Send, drafts: File, trash: Trash2, junk: AlertOctagon, archive: Archive, all: Archive, flagged: Star }
export const DND_TYPE = 'application/x-mailcity-messages'
const ACCOUNT_DND = 'application/x-mailcity-account'

export function Sidebar({ onAddAccount, onSettings, onAssistant }: { onAddAccount: () => void; onSettings: () => void; onAssistant: () => void }) {
  const qc = useQueryClient()
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const folders = useFolders()
  const { mailbox, setMailbox, openEditAccount } = useUi()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Record<string, { state: string; detail?: string }>>({})
  useMailEvent('sync.status', (e) => setStatus((s) => ({ ...s, [e.accountId]: { state: e.state, detail: e.detail } })))
  const outbox = useOutbox()
  const { newMessage } = useComposeActions()
  const savedSearches = useQuery({ queryKey: ['savedSearches'], queryFn: () => invoke('search.saved.list') })
  const menu = useContextMenu()
  const actions = useMailActions()
  const layout = useLayout()
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null)

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['accounts.list'] })
    void qc.invalidateQueries({ queryKey: ['folders'] })
    void qc.invalidateQueries({ queryKey: ['messages'] })
  }
  const unifiedUnread = folders.data?.filter((f) => f.specialUse === 'inbox').reduce((n, f) => n + f.unreadCount, 0) ?? 0
  const isSel = (s: MailboxSelection) => {
    // While searching inside a folder, keep that folder highlighted.
    const cur = mailbox.kind === 'search' && mailbox.within && s.kind !== 'search' ? mailbox.within : mailbox
    const strip = (x: MailboxSelection) => (x.kind === 'search' ? { kind: 'search', query: x.query } : x)
    return JSON.stringify(strip(s)) === JSON.stringify(strip(cur))
  }

  // Right-click on the unified views: act on every account at once.
  const unifiedMenu = (sel: MailboxSelection, specialUse: string): MenuItem[] => {
    const targets = (folders.data ?? []).filter((f) => f.specialUse === specialUse && f.unreadCount > 0)
    return [
      { label: 'Open', onSelect: () => setMailbox(sel) },
      ...(specialUse === 'inbox' ? [{ label: 'Mark all as read', disabled: !targets.length, onSelect: () => void Promise.all(targets.map((f) => invoke('folders.markAllRead', { id: f.id }))).then(refresh) }] : []),
      { type: 'separator' },
      { label: 'Sync all accounts', onSelect: () => void invoke('sync.now', {}) }
    ]
  }

  // Drag an account header onto another to reorder.
  const dropAccount = (targetId: string, after: boolean, e: DragEvent) => {
    e.preventDefault()
    setDropAt(null)
    const dragged = e.dataTransfer.getData(ACCOUNT_DND)
    const ids = (accounts.data ?? []).map((a) => a.id)
    const from = ids.indexOf(dragged)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || dragged === targetId) return
    const next = reorder(ids, from, to, after)
    if (next.join() !== ids.join()) void invoke('accounts.reorder', { ids: next }).then(refresh)
  }

  const onDropToFolder = (f: Folder) => (e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DND_TYPE)
    if (!raw) return
    const { ids, accountId } = JSON.parse(raw) as { ids: string[]; accountId: string }
    if (accountId !== f.accountId || !ids.length) return
    actions.move.mutate({ ids, toFolderId: f.id })
  }

  if (layout.sidebarCollapsed) {
    const rail: [LucideIcon, string, MailboxSelection, string | null, number | undefined][] = [
      [Inbox, 'All inboxes', { kind: 'unified', specialUse: 'inbox' }, 'inbox', unifiedUnread],
      [Sparkles, 'Focused', { kind: 'unified', specialUse: 'focused' }, 'inbox', undefined],
      [Star, 'Starred', { kind: 'unified', specialUse: 'flagged' }, 'inbox', undefined],
      [Send, 'All sent', { kind: 'unified', specialUse: 'sent' }, 'sent', undefined],
      [File, 'All drafts', { kind: 'unified', specialUse: 'drafts' }, 'drafts', undefined],
      [AlarmClock, 'Snoozed', { kind: 'snoozed' }, null, undefined],
      [Clock, 'Outbox & local drafts', { kind: 'outbox' }, null, outbox.data?.length]
    ]
    return (
      <aside className="flex shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2 text-sm" style={{ width: COLLAPSED_SIDEBAR_WIDTH }}>
        <RailButton icon={PanelLeftOpen} label="Expand sidebar (Ctrl+Shift+S)" onClick={layout.toggleSidebar} />
        <button className="mb-1 rounded-md bg-accent p-2 text-accent-fg hover:opacity-90 disabled:opacity-40" title="Compose (c)" aria-label="Compose" onClick={() => void newMessage()} disabled={!accounts.data?.length}>
          <PenSquare className="size-4" />
        </button>
        {rail.map(([icon, label, sel, su, count]) => (
          <RailButton key={label} icon={icon} label={label} active={isSel(sel)} badge={count} onClick={() => setMailbox(sel)} onContextMenu={su ? (e) => menu.open(e, unifiedMenu(sel, su)) : undefined} />
        ))}
        <div className="my-1 h-px w-8 bg-border" />
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
          {accounts.data?.map((a) => {
            const afolders = folders.data?.filter((f) => f.accountId === a.id) ?? []
            const unread = afolders.filter((f) => f.specialUse === 'inbox').reduce((n, f) => n + f.unreadCount, 0)
            const inbox = afolders.find((f) => f.specialUse === 'inbox')
            const folderItems: MenuItem[] = [{ type: 'label', label: a.displayName }, ...afolders.map<MenuItem>((f) => ({ label: f.unreadCount ? `${f.name}  (${f.unreadCount})` : f.name, onSelect: () => setMailbox({ kind: 'folder', accountId: a.id, folderId: f.id }) }))]
            return (
              <button
                key={a.id}
                className={cn('relative flex size-9 items-center justify-center rounded-md hover:bg-hover', a.lastError && 'ring-1 ring-danger')}
                title={`${a.displayName} <${a.email}>${a.lastError ? ` · ${a.lastError}` : ''}`}
                aria-label={a.displayName}
                onClick={(e) => menu.openAt(e.currentTarget, folderItems)}
                onContextMenu={(e) => menu.open(e, accountMenu(a, { accounts: accounts.data ?? [], inbox, refresh, openSettings: (tab) => openEditAccount(a.id, tab) }))}
              >
                <span className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: a.color, opacity: a.enabled ? 1 : 0.5 }}>
                  {a.displayName.slice(0, 1).toUpperCase()}
                </span>
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[9px] leading-4 text-accent-fg">{unread > 99 ? '99+' : unread}</span>}
              </button>
            )
          })}
          <RailButton icon={Plus} label="Add account" onClick={onAddAccount} />
        </div>
        <RailButton icon={Bot} label="Assistant (Ctrl+J)" onClick={onAssistant} />
        <RailButton icon={Settings} label="Settings" onClick={onSettings} />
      </aside>
    )
  }

  return (
    <aside className="flex shrink-0 flex-col border-r border-border bg-panel text-sm" style={{ width: layout.sidebar }}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-2 font-semibold">
          <Mail className="size-4 text-accent" /> Mail City
        </span>
        <span className="flex items-center">
          <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Sync all" aria-label="Sync all" onClick={() => invoke('sync.now', {})}>
            <RefreshCw className="size-3.5" />
          </button>
          <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Collapse sidebar (Ctrl+Shift+S)" aria-label="Collapse sidebar" onClick={layout.toggleSidebar}>
            <PanelLeftClose className="size-3.5" />
          </button>
        </span>
      </div>

      <div className="px-2 pb-2">
        <Button variant="primary" className="w-full" onClick={() => void newMessage()} disabled={!accounts.data?.length}>
          <PenSquare className="size-4" /> Compose
        </Button>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          <NavRow icon={Inbox} label="All inboxes" count={unifiedUnread} active={isSel({ kind: 'unified', specialUse: 'inbox' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'inbox' })} onContextMenu={(e) => menu.open(e, unifiedMenu({ kind: 'unified', specialUse: 'inbox' }, 'inbox'))} />
          <NavRow icon={Sparkles} label="Focused" active={isSel({ kind: 'unified', specialUse: 'focused' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'focused' })} onContextMenu={(e) => menu.open(e, unifiedMenu({ kind: 'unified', specialUse: 'focused' }, 'inbox'))} />
          <NavRow icon={Star} label="Starred" active={isSel({ kind: 'unified', specialUse: 'flagged' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'flagged' })} onContextMenu={(e) => menu.open(e, unifiedMenu({ kind: 'unified', specialUse: 'flagged' }, 'inbox'))} />
          <NavRow icon={Send} label="All sent" active={isSel({ kind: 'unified', specialUse: 'sent' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'sent' })} onContextMenu={(e) => menu.open(e, unifiedMenu({ kind: 'unified', specialUse: 'sent' }, 'sent'))} />
          <NavRow icon={File} label="All drafts" active={isSel({ kind: 'unified', specialUse: 'drafts' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'drafts' })} onContextMenu={(e) => menu.open(e, unifiedMenu({ kind: 'unified', specialUse: 'drafts' }, 'drafts'))} />
          <NavRow icon={AlarmClock} label="Snoozed" active={isSel({ kind: 'snoozed' })} onClick={() => setMailbox({ kind: 'snoozed' })} />
          <NavRow icon={Clock} label="Outbox & local drafts" count={outbox.data?.length} active={isSel({ kind: 'outbox' })} onClick={() => setMailbox({ kind: 'outbox' })} />
        </div>

        {(savedSearches.data?.length ?? 0) > 0 && (
          <div className="space-y-0.5">
            <div className="px-2 text-xs font-semibold text-muted">Saved searches</div>
            {savedSearches.data!.map((s) => (
              <NavRow
                key={s.id}
                icon={Search}
                label={s.name}
                active={isSel({ kind: 'search', query: s.query })}
                onClick={() => setMailbox({ kind: 'search', query: s.query, within: null })}
                onContextMenu={(e) =>
                  menu.open(e, [
                    { label: 'Run search', onSelect: () => setMailbox({ kind: 'search', query: s.query, within: null }) },
                    { label: 'Remove', danger: true, onSelect: () => void invoke('search.saved.set', (savedSearches.data ?? []).filter((x) => x.id !== s.id)).then(() => qc.invalidateQueries({ queryKey: ['savedSearches'] })) }
                  ])
                }
              />
            ))}
          </div>
        )}

        {accounts.data?.map((a) => {
          const afolders = folders.data?.filter((f) => f.accountId === a.id) ?? []
          const open = !collapsed[a.id]
          const st = status[a.id]
          const inbox = afolders.find((f) => f.specialUse === 'inbox')
          const openMenu = (e: React.MouseEvent) => menu.open(e, accountMenu(a, { accounts: accounts.data ?? [], inbox, refresh, openSettings: (tab) => openEditAccount(a.id, tab) }))
          return (
            <div key={a.id}>
              <div
                className={cn(
                  'group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-semibold text-muted hover:bg-hover',
                  !a.enabled && 'opacity-60',
                  dropAt?.id === a.id && (dropAt.after ? 'shadow-[inset_0_-2px_0_var(--color-accent)]' : 'shadow-[inset_0_2px_0_var(--color-accent)]')
                )}
                onContextMenu={openMenu}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(ACCOUNT_DND, a.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(ACCOUNT_DND)) return
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  const after = e.clientY > r.top + r.height / 2
                  if (dropAt?.id !== a.id || dropAt.after !== after) setDropAt({ id: a.id, after })
                }}
                onDragLeave={() => setDropAt((d) => (d?.id === a.id ? null : d))}
                onDrop={(e) => dropAccount(a.id, dropAt?.after ?? false, e)}
                onDragEnd={() => setDropAt(null)}
              >
                <GripVertical className="-ml-1 size-3 shrink-0 cursor-grab opacity-0 group-hover:opacity-60" aria-hidden />
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setCollapsed((c) => ({ ...c, [a.id]: open }))} title={`${a.email} · drag to reorder`}>
                  {open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}
                  <span className="size-2 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="truncate">{a.displayName}</span>
                </button>
                {st?.state === 'syncing' && <RefreshCw className="size-3 shrink-0 animate-spin" />}
                {!a.enabled && <span className="text-[10px]">paused</span>}
                <button className="rounded p-0.5 opacity-0 hover:bg-bg group-hover:opacity-100" onClick={(e) => menu.openAt(e.currentTarget, accountMenu(a, { accounts: accounts.data ?? [], inbox, refresh, openSettings: (tab) => openEditAccount(a.id, tab) }))} aria-label="Account menu">
                  <MoreHorizontal className="size-3.5" />
                </button>
              </div>
              {a.lastError && (
                <button className="mx-1.5 mb-1 block w-[calc(100%-0.75rem)] truncate rounded bg-danger/10 px-2 py-1 text-left text-[11px] text-danger hover:bg-danger/20" title={a.lastError} onClick={() => openEditAccount(a.id, 'signin')}>
                  Sign-in failed — click to fix
                </button>
              )}
              {open && (
                <div className="space-y-0.5">
                  {afolders.length === 0 && <div className="px-6 py-1 text-xs text-muted">{a.enabled ? (st?.detail ?? 'Connecting…') : 'Sync paused'}</div>}
                  {afolders.map((f) => (
                    <FolderRow
                      key={f.id}
                      folder={f}
                      active={isSel({ kind: 'folder', accountId: a.id, folderId: f.id })}
                      onClick={() => setMailbox({ kind: 'folder', accountId: a.id, folderId: f.id })}
                      onContextMenu={(e) => menu.open(e, folderMenu(f, { open: () => setMailbox({ kind: 'folder', accountId: a.id, folderId: f.id }), refresh }))}
                      onDrop={onDropToFolder(f)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-muted hover:bg-hover hover:text-fg" onClick={onAddAccount}>
          <Plus className="size-4" /> Add account
        </button>
      </nav>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
        <span>{accounts.data?.length ?? 0} account{accounts.data?.length === 1 ? '' : 's'}</span>
        <span className="flex items-center gap-1">
          <button className="rounded p-1 hover:bg-hover hover:text-fg" onClick={onAssistant} aria-label="Assistant" title="Assistant (Ctrl+J)">
            <Bot className="size-4" />
          </button>
          <button className="rounded p-1 hover:bg-hover hover:text-fg" onClick={onSettings} aria-label="Settings">
            <Settings className="size-4" />
          </button>
        </span>
      </div>
    </aside>
  )
}

function NavRow({ icon: Icon, label, count, active, onClick, onContextMenu }: { icon: LucideIcon; label: string; count?: number; active: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover compact:py-1', active && 'bg-hover font-medium')} onClick={onClick} onContextMenu={onContextMenu}>
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className="text-xs text-muted">{count}</span>}
    </button>
  )
}

function FolderRow({ folder, active, onClick, onContextMenu, onDrop }: { folder: Folder; active: boolean; onClick: () => void; onContextMenu: (e: React.MouseEvent) => void; onDrop: (e: DragEvent) => void }) {
  const Icon = (folder.specialUse && SPECIAL_ICON[folder.specialUse]) || FolderIcon
  const depth = folder.delimiter ? folder.path.split(folder.delimiter).length - 1 : 0
  const [over, setOver] = useState(false)
  return (
    <button
      className={cn('flex w-full items-center gap-2 rounded py-1 pr-2 text-left hover:bg-hover compact:py-0.5', active && 'bg-hover font-medium', over && 'bg-accent/20 ring-1 ring-accent')}
      style={{ paddingLeft: 24 + depth * 12 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={folder.path}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        onDrop(e)
      }}
    >
      <Icon className="size-3.5 shrink-0 text-muted" />
      <span className="flex-1 truncate">{folder.name}</span>
      {folder.unreadCount > 0 && <span className="text-xs text-muted">{folder.unreadCount}</span>}
    </button>
  )
}

function RailButton({ icon: Icon, label, active, badge, onClick, onContextMenu }: { icon: LucideIcon; label: string; active?: boolean; badge?: number; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button className={cn('relative flex size-9 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg', active && 'bg-hover text-fg')} title={label} aria-label={label} onClick={onClick} onContextMenu={onContextMenu}>
      <Icon className="size-4" />
      {!!badge && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[9px] leading-4 text-accent-fg">{badge > 99 ? '99+' : badge}</span>}
    </button>
  )
}
