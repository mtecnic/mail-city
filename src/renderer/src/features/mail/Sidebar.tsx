import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, ChevronDown, ChevronRight, File, Folder as FolderIcon, Inbox, Mail, PenSquare, Plus, RefreshCw, Send, Settings, Star, Trash2, AlertOctagon, Clock, type LucideIcon } from 'lucide-react'
import { invoke, useMailEvent } from '@renderer/lib/api'
import { Button, cn } from '@renderer/components/ui'
import { useUi, type MailboxSelection } from '@renderer/store/ui'
import { useFolders } from './hooks'
import { useOutbox } from '@renderer/features/compose/OutboxView'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import type { Folder } from '@shared/schemas/mail'

const SPECIAL_ICON: Record<string, LucideIcon> = { inbox: Inbox, sent: Send, drafts: File, trash: Trash2, junk: AlertOctagon, archive: Archive, all: Archive, flagged: Star }

export function Sidebar({ onAddAccount, onSettings }: { onAddAccount: () => void; onSettings: () => void }) {
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const folders = useFolders()
  const { mailbox, setMailbox } = useUi()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<Record<string, { state: string; detail?: string }>>({})
  useMailEvent('sync.status', (e) => setStatus((s) => ({ ...s, [e.accountId]: { state: e.state, detail: e.detail } })))
  const outbox = useOutbox()
  const { newMessage } = useComposeActions()

  const unifiedUnread = folders.data?.filter((f) => f.specialUse === 'inbox').reduce((n, f) => n + f.unreadCount, 0) ?? 0
  const isSel = (s: MailboxSelection) => JSON.stringify(s) === JSON.stringify(mailbox)

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
          <NavRow icon={Star} label="Starred" active={isSel({ kind: 'unified', specialUse: 'flagged' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'flagged' })} />
          <NavRow icon={Send} label="All sent" active={isSel({ kind: 'unified', specialUse: 'sent' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'sent' })} />
          <NavRow icon={File} label="All drafts" active={isSel({ kind: 'unified', specialUse: 'drafts' })} onClick={() => setMailbox({ kind: 'unified', specialUse: 'drafts' })} />
          <NavRow icon={Clock} label="Outbox & local drafts" count={outbox.data?.length} active={isSel({ kind: 'outbox' })} onClick={() => setMailbox({ kind: 'outbox' })} />
        </div>

        {accounts.data?.map((a) => {
          const afolders = folders.data?.filter((f) => f.accountId === a.id) ?? []
          const open = !collapsed[a.id]
          const st = status[a.id]
          return (
            <div key={a.id}>
              <button className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs font-semibold text-muted hover:bg-hover" onClick={() => setCollapsed((c) => ({ ...c, [a.id]: open }))}>
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                <span className="size-2 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className="truncate">{a.displayName}</span>
                {st?.state === 'syncing' && <RefreshCw className="ml-auto size-3 animate-spin" />}
                {(st?.state === 'error' || st?.state === 'offline' || a.lastError) && (
                  <span className="ml-auto size-2 rounded-full bg-danger" title={st?.detail ?? a.lastError ?? ''} />
                )}
              </button>
              {open && (
                <div className="space-y-0.5">
                  {afolders.length === 0 && <div className="px-6 py-1 text-xs text-muted">{st?.detail ?? 'Connecting…'}</div>}
                  {afolders.map((f) => (
                    <FolderRow key={f.id} folder={f} active={isSel({ kind: 'folder', accountId: a.id, folderId: f.id })} onClick={() => setMailbox({ kind: 'folder', accountId: a.id, folderId: f.id })} />
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
        <button className="rounded p-1 hover:bg-hover hover:text-fg" onClick={onSettings} aria-label="Settings">
          <Settings className="size-4" />
        </button>
      </div>
    </aside>
  )
}

function NavRow({ icon: Icon, label, count, active, onClick }: { icon: LucideIcon; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-hover', active && 'bg-hover font-medium')} onClick={onClick}>
      <Icon className="size-4 shrink-0 text-muted" />
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className="text-xs text-muted">{count}</span>}
    </button>
  )
}

function FolderRow({ folder, active, onClick }: { folder: Folder; active: boolean; onClick: () => void }) {
  const Icon = (folder.specialUse && SPECIAL_ICON[folder.specialUse]) || FolderIcon
  const depth = folder.delimiter ? folder.path.split(folder.delimiter).length - 1 : 0
  return (
    <button className={cn('flex w-full items-center gap-2 rounded py-1 pr-2 text-left hover:bg-hover', active && 'bg-hover font-medium')} style={{ paddingLeft: 24 + depth * 12 }} onClick={onClick} title={folder.path}>
      <Icon className="size-3.5 shrink-0 text-muted" />
      <span className="flex-1 truncate">{folder.name}</span>
      {folder.unreadCount > 0 && <span className="text-xs text-muted">{folder.unreadCount}</span>}
    </button>
  )
}
