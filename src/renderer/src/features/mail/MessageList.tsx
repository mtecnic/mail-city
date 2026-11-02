import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Paperclip, Star } from 'lucide-react'
import { cn, Spinner } from '@renderer/components/ui'
import { useUi } from '@renderer/store/ui'
import { formatListDate, initials, avatarColor } from '@renderer/lib/format'
import { useMessageList, useMailActions } from './hooks'
import type { MessageListItem } from '@shared/schemas/mail'

export function MessageList() {
  const { mailbox, selectedMessageId, selectedIds, selectMessage } = useUi()
  const q = useMessageList(mailbox)
  const actions = useMailActions()
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

  // Keyboard navigation inside the list.
  const onKey = (e: React.KeyboardEvent) => {
    const idx = items.findIndex((m) => m.id === selectedMessageId)
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[Math.min(items.length - 1, idx + 1)]
      if (next) {
        selectMessage(next.id)
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

  return (
    <div ref={parentRef} className="h-full flex-1 overflow-y-auto outline-none" tabIndex={0} onKeyDown={onKey}>
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
                  onStar={() => actions.setFlags.mutate({ ids: [m.id], flags: { flagged: !m.flags.flagged } })}
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
  )
}

function Row({ m, active, checked, onClick, onStar }: { m: MessageListItem; active: boolean; checked: boolean; onClick: (e: React.MouseEvent) => void; onStar: () => void }) {
  const unread = !m.flags.seen
  const who = m.from.name || m.from.address
  return (
    <div className={cn('group flex cursor-default gap-3 border-b border-border px-3 py-2 select-none', active ? 'bg-accent/15' : checked ? 'bg-accent/10' : 'hover:bg-hover')} onClick={onClick}>
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
