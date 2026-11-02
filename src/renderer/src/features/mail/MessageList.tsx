import { useEffect, useMemo, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Archive, AlertOctagon, FolderInput, MailOpen, Paperclip, Star, Trash2, X } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, cn, Spinner } from '@renderer/components/ui'
import { useContextMenu } from '@renderer/components/ContextMenu'
import { useUi } from '@renderer/store/ui'
import { formatListDate, initials, avatarColor } from '@renderer/lib/format'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import { useMessageList, useMailActions, useFolders } from './hooks'
import { messageMenu, type MessageMenuDeps } from './menus'
import { DND_TYPE } from './Sidebar'
import type { MessageListItem } from '@shared/schemas/mail'

/** Everything the message menu / shortcuts need, shared by list, reading pane and MailView. */
export function useMessageMenuDeps(): MessageMenuDeps {
  const qc = useQueryClient()
  const folders = useFolders()
  const actions = useMailActions()
  const compose = useComposeActions()
  const { selectMessage, setSourceMessageId } = useUi()
  const snooze = useMutation({
    mutationFn: (v: { ids: string[]; until: Date }) => invoke('messages.snooze', { ids: v.ids, until: v.until.toISOString() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['messages'] })
      selectMessage(null)
    }
  })
  const clear = (fn: (ids: string[]) => void) => (ids: string[]) => {
    fn(ids)
    selectMessage(null)
  }
  return useMemo(
    () => ({
      folders: folders.data ?? [],
      actions: {
        setFlags: (v) => actions.setFlags.mutate(v as never),
        archive: clear((ids) => actions.archive.mutate(ids)),
        del: clear((ids) => actions.del.mutate(ids)),
        move: (v) => {
          actions.move.mutate(v)
          selectMessage(null)
        },
        junk: (v) => {
          actions.junk.mutate(v)
          selectMessage(null)
        }
      },
      reply: (id, mode) => void compose.reply(id, mode),
      snooze: (ids, until) => snooze.mutate({ ids, until }),
      viewSource: (id) => setSourceMessageId(id),
      open: (id) => selectMessage(id)
    }),
    [folders.data, actions.setFlags, actions.archive, actions.del, actions.move, actions.junk, compose, snooze, selectMessage, setSourceMessageId]
  )
}

export function MessageList() {
  const { mailbox, selectedMessageId, selectedIds, selectMessage, clearSelection } = useUi()
  const q = useMessageList(mailbox)
  const actions = useMailActions()
  const deps = useMessageMenuDeps()
  const menu = useContextMenu()
  const items = useMemo(() => q.data?.pages.flat() ?? [], [q.data])
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: items.length + (q.hasNextPage ? 1 : 0),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 12
  })

  const vItems = rowVirtualizer.getVirtualItems()
  useEffect(() => {
    const last = vItems[vItems.length - 1]
    if (last && last.index >= items.length - 1 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage()
  }, [vItems, items.length, q])

  const selected = items.filter((m) => selectedIds.includes(m.id))
  const openMenuFor = (e: React.MouseEvent, m: MessageListItem) => {
    const target = selectedIds.includes(m.id) && selectedIds.length > 1 ? selected : [m]
    if (!selectedIds.includes(m.id)) selectMessage(m.id)
    menu.open(e, messageMenu(target, deps))
  }

  const onKey = (e: React.KeyboardEvent) => {
    const idx = items.findIndex((m) => m.id === selectedMessageId)
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[Math.min(items.length - 1, idx + 1)]
      if (next) {
        selectMessage(next.id, e.shiftKey ? { range: items.slice(Math.min(idx, idx + 1), Math.max(idx, idx + 1) + 1).map((x) => x.id).concat(selectedIds) } : undefined)
        rowVirtualizer.scrollToIndex(Math.min(items.length - 1, idx + 1))
      }
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = items[Math.max(0, idx - 1)]
      if (prev) {
        selectMessage(prev.id)
        rowVirtualizer.scrollToIndex(Math.max(0, idx - 1))
      }
    }
  }

  if (q.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!items.length) return <div className="flex flex-1 items-center justify-center text-sm text-muted">{q.isError ? q.error.message : 'Nothing here.'}</div>

  const allSelected = items.length > 0 && selectedIds.length >= items.length
  const ids = selectedIds

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 items-center gap-2 border-b border-border px-3 text-xs">
        <input type="checkbox" checked={allSelected} onChange={(e) => (e.target.checked ? selectMessage(items[0]!.id, { range: items.map((m) => m.id) }) : clearSelection())} title="Select all loaded" />
        {ids.length > 1 ? (
          <>
            <span className="text-muted">{ids.length} selected</span>
            <span className="ml-auto flex items-center gap-0.5">
              <Button size="sm" variant="ghost" title="Mark read" onClick={() => actions.setFlags.mutate({ ids, flags: { seen: true } })}>
                <MailOpen className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Archive" onClick={() => deps.actions.archive(ids)}>
                <Archive className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Move to…" onClick={(e) => menu.openAt(e.currentTarget, messageMenu(selected, deps).filter((i) => 'label' in i && i.label === 'Move to…'))}>
                <FolderInput className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Junk" onClick={() => deps.actions.junk({ ids, junk: true })}>
                <AlertOctagon className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Delete" onClick={() => deps.actions.del(ids)}>
                <Trash2 className="size-3.5" />
              </Button>
              <Button size="sm" variant="ghost" title="Clear selection" onClick={clearSelection}>
                <X className="size-3.5" />
              </Button>
            </span>
          </>
        ) : (
          <span className="text-muted">{items.length}{q.hasNextPage ? '+' : ''} messages</span>
        )}
      </div>
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto outline-none" tabIndex={0} onKeyDown={onKey}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {vItems.map((v) => {
            const m = items[v.index]
            return (
              <div key={v.key} data-index={v.index} ref={rowVirtualizer.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${v.start}px)` }}>
                {m ? (
                  <Row
                    m={m}
                    active={m.id === selectedMessageId}
                    checked={selectedIds.includes(m.id)}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) selectMessage(m.id, { toggle: true })
                      else if (e.shiftKey && selectedMessageId) {
                        const a = items.findIndex((x) => x.id === selectedMessageId)
                        const b = v.index
                        selectMessage(m.id, { range: items.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id) })
                      } else selectMessage(m.id)
                    }}
                    onContextMenu={(e) => openMenuFor(e, m)}
                    onToggle={() => selectMessage(m.id, { toggle: true })}
                    onStar={() => actions.setFlags.mutate({ ids: [m.id], flags: { flagged: !m.flags.flagged } })}
                    dragIds={selectedIds.includes(m.id) ? selectedIds : [m.id]}
                  />
                ) : (
                  <div className="flex h-12 items-center justify-center">
                    <Spinner />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Row({ m, active, checked, onClick, onContextMenu, onToggle, onStar, dragIds }: { m: MessageListItem; active: boolean; checked: boolean; onClick: (e: React.MouseEvent) => void; onContextMenu: (e: React.MouseEvent) => void; onToggle: () => void; onStar: () => void; dragIds: string[] }) {
  const unread = !m.flags.seen
  const who = m.from.name || m.from.address
  return (
    <div
      className={cn('group flex cursor-default gap-2 border-b border-border px-2 py-2 select-none', active ? 'bg-accent/15' : checked ? 'bg-accent/10' : 'hover:bg-hover')}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_TYPE, JSON.stringify({ ids: dragIds, accountId: m.accountId }))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <input
        type="checkbox"
        className={cn('mt-2.5 size-3.5 shrink-0', !checked && 'opacity-0 group-hover:opacity-100')}
        checked={checked}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        aria-label="Select"
      />
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white" style={{ background: avatarColor(m.from.address) }}>
        {initials(m.from.name, m.from.address)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'text-fg')}>{who}</span>
          {m.threadCount > 1 && <span className="text-xs text-muted">{m.threadCount}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted">{formatListDate(m.date)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm', unread && 'font-medium')}>{m.subject || '(no subject)'}</span>
          {m.hasAttachments && <Paperclip className="size-3 shrink-0 text-muted" />}
          {m.aiPriority !== null && m.aiPriority >= 3 && <span className="shrink-0 rounded bg-danger/15 px-1 text-[10px] font-medium text-danger">urgent</span>}
          {m.aiCategory && !['primary', 'needs_reply'].includes(m.aiCategory) && <span className="shrink-0 rounded bg-hover px-1 text-[10px] text-muted">{m.aiCategory.replace('_', ' ')}</span>}
          {m.aiCategory === 'needs_reply' && <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">reply</span>}
        </div>
        <div className="truncate text-xs text-muted">{m.snippet}</div>
      </div>
      <button
        className={cn('self-start rounded p-0.5', m.flags.flagged ? 'text-yellow-500' : 'text-muted opacity-0 group-hover:opacity-100')}
        onClick={(e) => {
          e.stopPropagation()
          onStar()
        }}
        aria-label="Star"
      >
        <Star className="size-3.5" fill={m.flags.flagged ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}
