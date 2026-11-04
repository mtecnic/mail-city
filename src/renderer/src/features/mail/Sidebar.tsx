import { useState, type DragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, File, Folder as FolderIcon, Inbox, Mail, PenSquare, Plus, RefreshCw, Send, Settings, Star, Trash2, AlertOctagon, Clock, AlarmClock, Search, Sparkles, Bot, MoreHorizontal, type LucideIcon } from 'lucide-react'
import { invoke, useMailEvent } from '@renderer/lib/api'
import { Button, cn } from '@renderer/components/ui'
import { useContextMenu } from '@renderer/components/ContextMenu'
import { useUi, type MailboxSelection } from '@renderer/store/ui'
import { useFolders, useMailActions } from './hooks'
import { accountMenu, folderMenu } from './menus'
import { useOutbox } from '@renderer/features/compose/OutboxView'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import type { Folder } from '@shared/schemas/mail'

const SPECIAL_ICON: Record<string, LucideIcon> = { inbox: Inbox, sent: Send, drafts: File, trash: Trash2, junk: AlertOctagon, archive: Archive, all: Archive, flagged: Star }
export const DND_TYPE = 'application/x-mailcity-messages'

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

  const onDropToFolder = (f: Folder) => (e: DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DND_TYPE)
    if (!raw) return
    const { ids, accountId } = JSON.parse(raw) as { ids: string[]; accountId: string }
    if (accountId !== f.accountId || !ids.length) return
    actions.move.mutate({ ids, toFolderId: f.id })
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-panel text-sm">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-2 font-semibold">
          <Mail className="size-4 text-accent" /> Mail City
        </span>
        <button className="rounded p-1 text-muted hover:bg-hover hover:text-fg" title="Sync all" onClick={() => invoke('sync.now', {})}>
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      <div className="px-2 pb-2">
        <Button variant="primary" className="w-full" onClick={() => void newMessage()} disabled={!accounts.data?.length}>
          <PenSquare className="size-4" /> Compose
        </Button>
      </div>

      <nav className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        <div className="space-y-0.5">
          <NavRow icon={Inbox} label="All inboxes" count={unifiedUnread} active={isSel({ kind: 'unified', specialUse: 'inbox' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'inbox' })} />
          <NavRow icon={Sparkles} label="Focused" active={isSel({ kind: 'unified', specialUse: 'focused' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'focused' })} />
          <NavRow icon={Star} label="Starred" active={isSel({ kind: 'unified', specialUse: 'flagged' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'flagged' })} />
          <NavRow icon={Send} label="All sent" active={isSel({ kind: 'unified', specialUse: 'sent' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'sent' })} />
          <NavRow icon={File} label="All drafts" active={isSel({ kind: 'unified', specialUse: 'drafts' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'drafts' })} />
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
              <div className={cn('group flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-semibold text-muted hover:bg-hover', !a.enabled && 'opacity-60')} onContextMenu={openMenu}>
                <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setCollapsed((c) => ({ ...c, [a.id]: open }))} title={a.email}>
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
    <button className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover', active && 'bg-hover font-medium')} onClick={onClick} onContextMenu={onContextMenu}>
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
      className={cn('flex w-full items-center gap-2 rounded py-1 pr-2 text-left hover:bg-hover', active && 'bg-hover font-medium', over && 'bg-accent/20 ring-1 ring-accent')}
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
