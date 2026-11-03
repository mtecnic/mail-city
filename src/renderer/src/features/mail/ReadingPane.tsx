import { Archive, Forward, Mail, MailOpen, MoreHorizontal, Reply, ReplyAll, Star, Trash2, AlertOctagon } from 'lucide-react'
import { Button, Spinner, cn } from '@renderer/components/ui'
import { useUi } from '@renderer/store/ui'
import { useMessage, useMailActions, useMessageList, useThread } from './hooks'
import { SnoozeMenu } from './SnoozeMenu'
import { useContextMenu } from '@renderer/components/ContextMenu'
import { useMessageMenuDeps } from './MessageList'
import { messageMenu } from './menus'
import { MessageCard } from './MessageCard'
import { ThreadView } from './ThreadView'
import type { MessageDetail, MessageListItem } from '@shared/schemas/mail'

export function ReadingPane({ onCompose }: { onCompose?: (mode: 'reply' | 'replyAll' | 'forward', m: MessageDetail) => void }) {
  const { selectedMessageId, selectedIds, selectMessage, mailbox } = useUi()
  const q = useMessage(selectedMessageId)
  const menu = useContextMenu()
  const deps = useMessageMenuDeps()
  const list = useMessageList(mailbox)
  const listItem = list.data?.pages.flat().find((x) => x.id === selectedMessageId)
  const actions = useMailActions()
  const m = q.data

  if (selectedIds.length > 1) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted">
        <p>{selectedIds.length} messages selected</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => actions.setFlags.mutate({ ids: selectedIds, flags: { seen: true } })}>
            <MailOpen className="size-3.5" /> Mark read
          </Button>
          <Button size="sm" onClick={() => actions.archive.mutate(selectedIds, { onSuccess: () => selectMessage(null) })}>
            <Archive className="size-3.5" /> Archive
          </Button>
          <Button size="sm" variant="danger" onClick={() => actions.del.mutate(selectedIds, { onSuccess: () => selectMessage(null) })}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>
      </div>
    )
  }
  if (!selectedMessageId) return <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a message to read it.</div>
  if (q.isLoading || !m) {
    return (
      <div className="flex flex-1 items-center justify-center">
        {q.isError ? <span className="text-sm text-danger">{q.error.message}</span> : <Spinner />}
      </div>
    )
  }

  const thread = useThread(m.threadId)
  const items = thread.data ?? []
  const menuItem = listItem ?? items.find((x) => x.id === m.id)
  const isConversation = items.length > 1
  const selfItem: MessageListItem = menuItem ?? { id: m.id, accountId: m.accountId, folderId: m.folderId, uid: 0, threadId: m.threadId, subject: m.subject, from: m.from, to: m.to, date: m.date, snippet: '', flags: m.flags, hasAttachments: m.attachments.some((a) => !a.isInline), labels: m.labels, aiCategory: null, aiPriority: null, threadCount: 1, threadUnread: 0, snoozedUntil: null }

  return (
    <div className="flex h-full flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => onCompose?.('reply', m)} title="Reply (r)">
          <Reply className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onCompose?.('replyAll', m)} title="Reply all (a)">
          <ReplyAll className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onCompose?.('forward', m)} title="Forward (f)">
          <Forward className="size-4" />
        </Button>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="ghost" onClick={() => actions.archive.mutate([m.id], { onSuccess: () => selectMessage(null) })} title="Archive (e)">
          <Archive className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.del.mutate([m.id], { onSuccess: () => selectMessage(null) })} title="Delete (#)">
          <Trash2 className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.junk.mutate({ ids: [m.id], junk: true }, { onSuccess: () => selectMessage(null) })} title="Mark as junk">
          <AlertOctagon className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.setFlags.mutate({ ids: [m.id], flags: { flagged: !m.flags.flagged } })} title={m.flags.flagged ? 'Remove star (s)' : 'Star (s)'}>
          <Star className={cn('size-4', m.flags.flagged && 'text-yellow-500')} fill={m.flags.flagged ? 'currentColor' : 'none'} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.setFlags.mutate({ ids: [m.id], flags: { seen: !m.flags.seen } })} title={m.flags.seen ? 'Mark unread (u)' : 'Mark read (Shift+I)'}>
          {m.flags.seen ? <Mail className="size-4" /> : <MailOpen className="size-4" />}
        </Button>
        <SnoozeMenu ids={[m.id]} />
        {isConversation && <span className="ml-2 text-xs text-muted">Acting on the highlighted message</span>}
        <Button size="sm" variant="ghost" className="ml-auto" title="More actions" onClick={(e) => menu.openAt(e.currentTarget, messageMenu([selfItem], deps))} onContextMenu={(e) => menu.open(e, messageMenu([selfItem], deps))}>
          <MoreHorizontal className="size-4" />
        </Button>
      </div>

      {isConversation ? (
        <ThreadView key={m.threadId} items={items} focusedId={m.id} subject={items[0]?.subject ?? m.subject} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border px-5 py-3">
            <h1 className="text-base font-semibold">{m.subject || '(no subject)'}</h1>
          </div>
          <MessageCard item={selfItem} expanded focused standalone />
        </div>
      )}
    </div>
  )
}
