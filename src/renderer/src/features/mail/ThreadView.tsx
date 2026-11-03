/**
 * Conversation view: every message of a thread stacked oldest-first. The selected
 * message and unread messages start expanded; clicking a header toggles a card and
 * makes it the "focused" message that the toolbar and shortcuts act on.
 */
import { useEffect, useRef, useState } from 'react'
import { useUi } from '@renderer/store/ui'
import { MessageCard } from './MessageCard'
import type { MessageListItem } from '@shared/schemas/mail'

export function ThreadView({ items, focusedId, subject }: { items: MessageListItem[]; focusedId: string; subject: string }) {
  const { selectMessage, cardToggle } = useUi()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(items.filter((m) => m.id === focusedId || !m.flags.seen).map((m) => m.id)))
  const known = useRef(new Set(items.map((m) => m.id)))

  // Newly arrived replies open automatically; the focused message is always open.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const m of items) {
        if (!known.current.has(m.id)) {
          known.current.add(m.id)
          if (!m.flags.seen) next.add(m.id)
        }
      }
      next.add(focusedId)
      return next
    })
  }, [items, focusedId])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size === 1) return prev // keep at least one message open
        next.delete(id)
      } else next.add(id)
      return next
    })

  // Enter shortcut from MailView: toggle the focused card on every bump after mount.
  const lastToggle = useRef(cardToggle)
  useEffect(() => {
    if (lastToggle.current === cardToggle) return
    lastToggle.current = cardToggle
    toggle(focusedId)
  }, [cardToggle, focusedId])

  const unread = items.filter((m) => !m.flags.seen).length
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-baseline gap-3 border-b border-border px-5 py-3">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{subject || '(no subject)'}</h1>
        <span className="shrink-0 text-xs text-muted">
          {items.length} messages{unread ? ` · ${unread} unread` : ''}
        </span>
      </div>
      {items.map((m) => (
        <MessageCard key={m.id} item={m} expanded={expanded.has(m.id)} focused={m.id === focusedId} onToggle={() => toggle(m.id)} onFocus={() => selectMessage(m.id)} />
      ))}
    </div>
  )
}
