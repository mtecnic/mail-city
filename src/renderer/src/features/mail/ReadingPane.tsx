import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Archive, Download, Forward, ImageIcon, MailOpen, Paperclip, Reply, ReplyAll, Star, Trash2, AlertOctagon } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Spinner, cn } from '@renderer/components/ui'
import { useUi } from '@renderer/store/ui'
import { formatFullDate, formatBytes, initials, avatarColor } from '@renderer/lib/format'
import { sanitizeEmailHtml, textToHtml, wrapForFrame } from '@renderer/lib/sanitize'
import { useMessage, useMailActions } from './hooks'
import { SnoozeMenu } from './SnoozeMenu'
import type { MessageDetail, Address } from '@shared/schemas/mail'

export function ReadingPane({ onCompose }: { onCompose?: (mode: 'reply' | 'replyAll' | 'forward', m: MessageDetail) => void }) {
  const { selectedMessageId, selectedIds, selectMessage } = useUi()
  const q = useMessage(selectedMessageId)
  const actions = useMailActions()
  const m = q.data

  // Mark read shortly after opening.
  useEffect(() => {
    if (!m || m.flags.seen) return
    const t = setTimeout(() => actions.setFlags.mutate({ ids: [m.id], flags: { seen: true } }), 800)
    return () => clearTimeout(t)
  }, [m?.id, m?.flags.seen]) // intentionally not depending on `actions`

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
        <Button size="sm" variant="ghost" onClick={() => actions.setFlags.mutate({ ids: [m.id], flags: { flagged: !m.flags.flagged } })} title="Star (s)">
          <Star className={cn('size-4', m.flags.flagged && 'text-yellow-500')} fill={m.flags.flagged ? 'currentColor' : 'none'} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.setFlags.mutate({ ids: [m.id], flags: { seen: !m.flags.seen } })} title="Mark unread (u)">
          <MailOpen className="size-4" />
        </Button>
        <SnoozeMenu ids={[m.id]} />
      </div>

      <div className="border-b border-border px-5 py-3">
        <h1 className="text-base font-semibold">{m.subject || '(no subject)'}</h1>
        <div className="mt-2 flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(m.from.address) }}>
            {initials(m.from.name, m.from.address)}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div>
              <span className="font-medium">{m.from.name || m.from.address}</span>
              {m.from.name && <span className="ml-1 text-muted">&lt;{m.from.address}&gt;</span>}
            </div>
            <AddrLine label="To" list={m.to} />
            <AddrLine label="Cc" list={m.cc} />
          </div>
          <div className="shrink-0 text-xs text-muted">{formatFullDate(m.date)}</div>
        </div>
      </div>

      <Body m={m} />

      {m.attachments.filter((a) => !a.isInline).length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
          {m.attachments
            .filter((a) => !a.isInline)
            .map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-1 text-xs">
                <Paperclip className="size-3.5 text-muted" />
                <button className="max-w-56 truncate hover:underline" title={a.filename} onClick={() => invoke('attachments.open', { id: a.id })}>
                  {a.filename}
                </button>
                <span className="text-muted">{formatBytes(a.size)}</span>
                <button className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg" title="Save as…" onClick={() => invoke('attachments.saveAs', { id: a.id })}>
                  <Download className="size-3.5" />
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

function AddrLine({ label, list }: { label: string; list: Address[] }) {
  if (!list.length) return null
  return (
    <div className="truncate text-xs text-muted" title={list.map((a) => a.address).join(', ')}>
      {label}: {list.map((a) => a.name || a.address).join(', ')}
    </div>
  )
}

function Body({ m }: { m: MessageDetail }) {
  const [allowRemote, setAllowRemote] = useState(false)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => invoke('settings.get') })
  const inline = m.attachments.filter((a) => a.isInline && a.contentId)
  const cidQuery = useQuery({
    queryKey: ['cid', m.id, inline.map((a) => a.id)],
    enabled: inline.length > 0 && m.bodyState === 'full',
    queryFn: async () => {
      const out: Record<string, string> = {}
      await Promise.all(inline.map(async (a) => {
        const url = await invoke('attachments.dataUrl', { id: a.id })
        if (url) out[a.contentId!] = url
      }))
      return out
    }
  })

  const dark = document.documentElement.classList.contains('dark')
  const allow = allowRemote || settings.data?.privacy.loadRemoteImages === 'always'
  const rendered = useMemo(() => {
    if (m.bodyState !== 'full') return null
    if (m.textHtml) return sanitizeEmailHtml(m.textHtml, { cid: cidQuery.data ?? {}, allowRemoteImages: !!allow })
    return { html: textToHtml(m.textPlain ?? ''), blockedRemoteImages: 0 }
  }, [m, cidQuery.data, allow])

  useEffect(() => setAllowRemote(false), [m.id])

  if (m.bodyState === 'unavailable') return <div className="flex flex-1 items-center justify-center text-sm text-muted">This account is offline; the message body hasn’t been downloaded yet.</div>
  if (!rendered) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Spinner /> Downloading…
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rendered.blockedRemoteImages > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-1.5 text-xs text-muted">
          <ImageIcon className="size-3.5" /> Remote images blocked for privacy.
          <button className="text-accent hover:underline" onClick={() => setAllowRemote(true)}>
            Load images
          </button>
        </div>
      )}
      <iframe
        title="message"
        className="min-h-0 flex-1 w-full bg-transparent"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={wrapForFrame(rendered.html, dark)}
      />
    </div>
  )
}
