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
import { SearchBar } from './SearchBar'
import { AppEvents, UpdateBanner } from '@renderer/features/app/AppEvents'
import { Welcome, ShortcutHelp } from '@renderer/features/app/Welcome'
import { AssistantPanel } from '@renderer/features/ai/AssistantPanel'
import { AskMailCard } from '@renderer/features/ai/AskMail'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/api'

export function MailView({ onSettings }: { onSettings: () => void }) {
  const [adding, setAdding] = useState(false)
  const [help, setHelp] = useState(false)
  const [assistant, setAssistant] = useState(false)
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const { mailbox, selectedMessageId, selectedIds, selectMessage } = useUi()
  const actions = useMailActions()
  const compose = useComposeActions()
  const folders = useFolders()

  const title = (() => {
    if (mailbox.kind === 'unified') return { inbox: 'All inboxes', focused: 'Focused', flagged: 'Starred', sent: 'All sent', drafts: 'All drafts' }[mailbox.specialUse]
    if (mailbox.kind === 'outbox') return 'Outbox'
    if (mailbox.kind === 'snoozed') return 'Snoozed'
    if (mailbox.kind === 'search') return `Search: ${mailbox.query}`
    return folders.data?.find((f) => f.id === mailbox.folderId)?.name ?? ''
  })()

  // Global keyboard shortcuts (Gmail-style).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAssistant((a) => !a)
        return
      }
      if (target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'c') {
        e.preventDefault()
        void compose.newMessage()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        setHelp((h) => !h)
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
    <div className="flex h-screen w-screen flex-col">
      <AppEvents />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
      <Sidebar onAddAccount={() => setAdding(true)} onSettings={onSettings} onAssistant={() => setAssistant((a) => !a)} />
      {accounts.data?.length === 0 ? (
        <Welcome onAddAccount={() => setAdding(true)} />
      ) : mailbox.kind === 'outbox' ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-10 items-center border-b border-border px-3 text-sm font-semibold">{title}</header>
          <OutboxView />
        </section>
      ) : (
        <>
          <section className="flex w-[380px] shrink-0 flex-col border-r border-border">
            <SearchBar />
            <header className="flex h-8 items-center border-b border-border px-3 text-xs font-semibold text-muted">{title}</header>
            {mailbox.kind === 'search' && <AskMailCard key={mailbox.query} question={mailbox.query} />}
            <MessageList />
          </section>
          <section className="flex min-w-0 flex-1 flex-col">
            <ReadingPane onCompose={(mode, m) => void compose.reply(m.id, mode)} />
          </section>
        </>
      )}
      {assistant && <AssistantPanel onClose={() => setAssistant(false)} />}
      </div>
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
      <ComposeDock />
      <UndoSendToast />
    </div>
  )
}
