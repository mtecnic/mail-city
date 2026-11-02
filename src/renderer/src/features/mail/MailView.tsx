import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { MessageList } from './MessageList'
import { ReadingPane } from './ReadingPane'
import { useUi } from '@renderer/store/ui'
import { useMailActions, useFolders } from './hooks'
import { AddAccountDialog } from '@renderer/features/accounts/AddAccountDialog'

export function MailView({ onSettings }: { onSettings: () => void }) {
  const [adding, setAdding] = useState(false)
  const { mailbox, selectedMessageId, selectedIds, selectMessage } = useUi()
  const actions = useMailActions()
  const folders = useFolders()

  const title = (() => {
    if (mailbox.kind === 'unified') return { inbox: 'All inboxes', flagged: 'Starred', sent: 'All sent', drafts: 'All drafts' }[mailbox.specialUse]
    return folders.data?.find((f) => f.id === mailbox.folderId)?.name ?? ''
  })()

  // Global keyboard shortcuts (Gmail-style).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]') || e.ctrlKey || e.metaKey || e.altKey) return
      const ids = selectedIds.length ? selectedIds : selectedMessageId ? [selectedMessageId] : []
      if (!ids.length) return
      switch (e.key) {
        case 'e':
          actions.archive.mutate(ids, { onSuccess: () => selectMessage(null) })
          break
        case '#':
        case 'Delete':
          actions.del.mutate(ids, { onSuccess: () => selectMessage(null) })
          break
        case 's':
          actions.setFlags.mutate({ ids, flags: { flagged: true } })
          break
        case 'u':
          actions.setFlags.mutate({ ids, flags: { seen: false } })
          break
        case 'Escape':
          selectMessage(null)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selectedIds, selectedMessageId, actions, selectMessage])

  return (
    <div className="flex h-screen w-screen">
      <Sidebar onAddAccount={() => setAdding(true)} onSettings={onSettings} />
      <section className="flex w-[380px] shrink-0 flex-col border-r border-border">
        <header className="flex h-10 items-center border-b border-border px-3 text-sm font-semibold">{title}</header>
        <MessageList />
      </section>
      <section className="flex min-w-0 flex-1 flex-col">
        <ReadingPane />
      </section>
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
