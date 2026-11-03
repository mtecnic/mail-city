/**
 * One message as shown in the reading pane: header, AI panel, sanitized body and
 * attachments. Used standalone for single messages and stacked by ThreadView.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ImageIcon, Paperclip, Star } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Spinner, cn } from '@renderer/components/ui'
import { formatFullDate, formatListDate, formatBytes, initials, avatarColor } from '@renderer/lib/format'
import { sanitizeEmailHtml, textToHtml, wrapForFrame } from '@renderer/lib/sanitize'
import { useContextMenu } from '@renderer/components/ContextMenu'
import { MessageAiPanel } from '@renderer/features/ai/MessageAiPanel'
import { useMessage, useMailActions } from './hooks'
import { messageMenu } from './menus'
import { useMessageMenuDeps } from './MessageList'
import type { MessageDetail, MessageListItem, Address } from '@shared/schemas/mail'

export function MessageCard({ item, expanded, focused, standalone, onToggle, onFocus }: { item: MessageListItem; expanded: boolean; focused: boolean; standalone?: boolean; onToggle?: () => void; onFocus?: () => void }) {
  const q = useMessage(item.id, expanded)
  const m = q.data
  const actions = useMailActions()
  const menu = useContextMenu()
  const deps = useMessageMenuDeps()
  const ref = useRef<HTMLDivElement>(null)

  // Mark read shortly after the body is shown.
  useEffect(() => {
    if (!expanded || !m || m.flags.seen) return
    const t = setTimeout(() => actions.setFlags.mutate({ ids: [m.id], flags: { seen: true } }), 800)
    return () => clearTimeout(t)
  }, [expanded, m?.id, m?.flags.seen]) // intentionally not depending on `actions`

  useEffect(() => {
    if (focused && !standalone) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focused, standalone])

  const unread = !item.flags.seen
  const header = (
    <div
      className={cn('flex items-start gap-3 px-5 py-3', !standalone && 'cursor-pointer select-none hover:bg-hover/60')}
      onClick={standalone ? undefined : () => (expanded && focused ? onToggle?.() : expanded ? onFocus?.() : (onToggle?.(), onFocus?.()))}
      onContextMenu={(e) => menu.open(e, messageMenu([item], deps))}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: avatarColor(item.from.address) }}>
        {initials(item.from.name, item.from.address)}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-2">
          <span className={cn('truncate', unread ? 'font-semibold' : 'font-medium')}>{item.from.name || item.from.address}</span>
          {item.from.name && expanded && <span className="truncate text-muted">&lt;{item.from.address}&gt;</span>}
          {item.flags.flagged && <Star className="size-3.5 shrink-0 text-yellow-500" fill="currentColor" />}
          <span className="ml-auto shrink-0 text-xs text-muted" title={formatFullDate(item.date)}>
            {expanded ? formatFullDate(item.date) : formatListDate(item.date)}
          </span>
        </div>
        {expanded && m ? (
          <>
            <AddrLine label="To" list={m.to} />
            <AddrLine label="Cc" list={m.cc} />
          </>
        ) : (
          !expanded && <div className="truncate text-xs text-muted">{item.snippet || (item.hasAttachments ? 'Attachment' : '')}</div>
        )}
      </div>
    </div>
  )

  if (!expanded) {
    return (
      <div ref={ref} className="border-b border-border">
        {header}
      </div>
    )
  }
  return (
    <div ref={ref} className={cn('flex flex-col border-b border-border', standalone && 'min-h-0 flex-1', focused && !standalone && 'ring-1 ring-inset ring-accent/30')}>
      {header}
      {!m ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">{q.isError ? <span className="text-danger">{q.error.message}</span> : <Spinner />}</div>
      ) : (
        <>
          {focused && (
            <div onContextMenu={(e) => menu.open(e, messageMenu([item], deps))}>
              <MessageAiPanel m={m} />
            </div>
          )}
          <Body m={m} fill={!!standalone} />
          {m.attachments.filter((a) => !a.isInline).length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
              {m.attachments
                .filter((a) => !a.isInline)
                .map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-1 text-xs"
                    onContextMenu={(e) =>
                      menu.open(e, [
                        { label: 'Open', onSelect: () => void invoke('attachments.open', { id: a.id }) },
                        { label: 'Save as…', onSelect: () => void invoke('attachments.saveAs', { id: a.id }) },
                        ...(/^image\//.test(a.mimeType) ? [{ label: 'Copy image', onSelect: () => void copyImage(a.id) }] : [])
                      ])
                    }
                  >
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
        </>
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

/**
 * Sanitized body in a sandboxed iframe. `fill` lets a single message take the whole
 * pane; in a conversation each frame sizes itself to its content instead.
 */
function Body({ m, fill }: { m: MessageDetail; fill: boolean }) {
  const [allowRemote, setAllowRemote] = useState(false)
  const [height, setHeight] = useState(240)
  const frame = useRef<HTMLIFrameElement>(null)
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => invoke('settings.get') })
  const inline = m.attachments.filter((a) => a.isInline && a.contentId)
  const cidQuery = useQuery({
    queryKey: ['cid', m.id, inline.map((a) => a.id)],
    enabled: inline.length > 0 && m.bodyState === 'full',
    queryFn: async () => {
      const out: Record<string, string> = {}
      await Promise.all(
        inline.map(async (a) => {
          const url = await invoke('attachments.dataUrl', { id: a.id })
          if (url) out[a.contentId!] = url
        })
      )
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

  // Size the frame to its document when stacked in a conversation (sandboxed, so measure on load).
  const measure = () => {
    const doc = frame.current?.contentDocument
    if (!doc) return
    const h = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0)
    if (h > 0) setHeight(Math.min(h + 16, 4000))
  }

  if (m.bodyState === 'unavailable') return <div className="flex flex-1 items-center justify-center py-6 text-sm text-muted">This account is offline; the message body hasn’t been downloaded yet.</div>
  if (!rendered) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-6 text-sm text-muted">
        <Spinner /> Downloading…
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col', fill && 'min-h-0 flex-1')}>
      {rendered.blockedRemoteImages > 0 && (
        <div className="flex items-center gap-2 border-b border-border bg-panel px-4 py-1.5 text-xs text-muted">
          <ImageIcon className="size-3.5" /> Remote images blocked for privacy.
          <button className="text-accent hover:underline" onClick={() => setAllowRemote(true)}>
            Load images
          </button>
        </div>
      )}
      <iframe
        ref={frame}
        title={`Message from ${m.from.name || m.from.address}`}
        className={cn('w-full bg-transparent', fill ? 'min-h-0 flex-1' : 'block')}
        style={fill ? undefined : { height }}
        sandbox={fill ? 'allow-popups allow-popups-to-escape-sandbox' : 'allow-popups allow-popups-to-escape-sandbox allow-same-origin'}
        onLoad={fill ? undefined : measure}
        srcDoc={wrapForFrame(rendered.html, dark)}
      />
    </div>
  )
}

export async function copyImage(attachmentId: string) {
  const url = await invoke('attachments.dataUrl', { id: attachmentId })
  if (!url) return
  const blob = await (await fetch(url)).blob()
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
  } catch {
    /* clipboard image unsupported */
  }
}
