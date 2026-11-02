import { useEffect, useState } from 'react'
import { Sidebar } from './Sidebar'
import { MessageList } from './MessageList'
import { ReadingPane } from './ReadingPane'
import { useUi } from '@renderer/store/ui'
import { useMailActions, useFolders } from './hooks'
import { AddAccountDialog } from '@renderer/features/accounts/AddAccountDialog'
import { ComposeDock } from '@renderer/features/compose/ComposeWindow'
import { OutboxView, UndoSendToast } from '@renderer/features/compose/OutboxView'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'

export function MailView({ onSettings }: { onSettings: () => void }) {
  const [adding, setAdding] = useState(false)
  const { mailbox, selectedMessageId, selectedIds, selectMessage } = useUi()
  const actions = useMailActions()
  const compose = useComposeActions()
  const folders = useFolders()

  const title = (() => {
    if (mailbox.kind === 'unified') return { inbox: 'All inboxes', flagged: 'Starred', sent: 'All sent', drafts: 'All drafts' }[mailbox.specialUse]
    if (mailbox.kind === 'outbox') return 'Outbox'
    return folders.data?.find((f) => f.id === mailbox.folderId)?.name ?? ''
  })()

  // Global keyboard shortcuts (Gmail-style).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'c') {
        e.preventDefault()
        void compose.newMessage()
        return
      }
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
        case 'r':
          if (selectedMessageId) void compose.reply(selectedMessageId, 'reply')
          break
        case 'a':
          if (selectedMessageId) void compose.reply(selectedMessageId, 'replyAll')
          break
        case 'f':
          if (selectedMessageId) void compose.reply(selectedMessageId, 'forward')
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
  }, [selectedIds, selectedMessageId, actions, selectMessage, compose])

  return (
    <div className="flex h-screen w-screen">
      <Sidebar onAddAccount={() => setAdding(true)} onSettings={onSettings} />
      {mailbox.kind === 'outbox' ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 items-center border-b border-border px-3 text-sm font-semibold">{title}</header>
          <OutboxView />
        </section>
      ) : (
        <>
          <section className="flex w-[380px] shrink-0 flex-col border-r border-border">
            <header className="flex h-10 items-center border-b border-border px-3 text-sm font-semibold">{title}</header>
            <MessageList />
          </section>
          <section className="flex min-w-0 flex-1 flex-col">
            <ReadingPane onCompose={(mode, m) => void compose.reply(m.id, mode)} />
          </section>
        </>
      )}
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <ComposeDock />
      <UndoSendToast />
    </div>
  )
}
