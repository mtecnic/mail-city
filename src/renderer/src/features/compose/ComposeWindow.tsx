import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Paperclip, Send, Trash2, X, Clock } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, Select, cn } from '@renderer/components/ui'
import { formatBytes } from '@renderer/lib/format'
import { useCompose, type ComposerState } from '@renderer/store/compose'
import { RecipientInput } from './RecipientInput'
import { useComposeEditor, EditorToolbar, EditorContent } from './Editor'
import type { DraftInput } from '@shared/schemas/compose'

export function ComposeDock() {
  const composers = useCompose((s) => s.composers)
  if (!composers.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-end gap-3 px-4">
      {composers.map((c) => (
        <ComposeWindow key={c.key} c={c} />
      ))}
    </div>
  )
}

function ComposeWindow({ c }: { c: ComposerState }) {
  const qc = useQueryClient()
  const { update, close } = useCompose()
  const [draftId, setDraftId] = useState<string | null>(c.draftId)
  const [status, setStatus] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  const editor = useComposeEditor(c.initialHtml)
  const identities = useQuery({ queryKey: ['identities', c.accountId], queryFn: () => invoke('identities.list', { accountId: c.accountId }) })
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })

  const buildDraft = useCallback(
    (): DraftInput => ({
      id: draftId ?? undefined,
      accountId: c.accountId,
      identityId: c.identityId,
      to: c.to,
      cc: c.cc,
      bcc: c.bcc,
      subject: c.subject,
      html: editor?.getHTML() ?? '',
      text: editor?.getText() ?? '',
      attachments: c.attachments,
      inReplyToMessageId: c.inReplyToMessageId,
      replyMode: c.replyMode
    }),
    [c, draftId, editor]
  )

  // Autosave locally (debounced) whenever something changes.
  const save = useMutation({
    mutationFn: () => invoke('drafts.save', buildDraft()),
    onSuccess: (d) => {
      setDraftId(d.id)
      dirty.current = false
      setStatus('Draft saved')
      void qc.invalidateQueries({ queryKey: ['drafts'] })
    }
  })
  useEffect(() => {
    dirty.current = true
    const t = setTimeout(() => dirty.current && !save.isPending && save.mutate(), 2500)
    return () => clearTimeout(t)
  }, [c.to, c.cc, c.bcc, c.subject, c.attachments, c.identityId])
  useEffect(() => {
    if (!editor) return
    const h = () => {
      dirty.current = true
      setStatus('')
    }
    editor.on('update', h)
    return () => {
      editor.off('update', h)
    }
  }, [editor])
  useEffect(() => {
    const t = setInterval(() => dirty.current && !save.isPending && save.mutate(), 5000)
    return () => clearInterval(t)
  }, [])

  const send = useMutation({
    mutationFn: (scheduledAt?: string) => invoke('compose.send', { draft: buildDraft(), scheduledAt }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['outbox'] })
      void qc.invalidateQueries({ queryKey: ['drafts'] })
      close(c.key)
    },
    onError: (e) => setError(e.message)
  })

  const pick = useMutation({
    mutationFn: () => invoke('compose.pickAttachments'),
    onSuccess: (files) => update(c.key, { attachments: [...c.attachments, ...files] })
  })

  const closeAndKeep = async () => {
    if (editor && (c.to.length || c.subject || editor.getText().trim() || c.attachments.length)) {
      const d = await invoke('drafts.save', buildDraft())
      void invoke('drafts.syncToServer', { id: d.id })
    } else if (draftId) {
      await invoke('drafts.discard', { id: draftId })
    }
    close(c.key)
  }
  const discard = async () => {
    if (draftId) await invoke('drafts.discard', { id: draftId })
    void qc.invalidateQueries({ queryKey: ['drafts'] })
    close(c.key)
  }

  const account = accounts.data?.find((a) => a.id === c.accountId)
  const canSend = (c.to.length || c.cc.length || c.bcc.length) > 0 && !send.isPending

  if (c.minimized) {
    return (
      <div className="pointer-events-auto flex w-64 cursor-pointer items-center justify-between rounded-t-lg border border-border bg-panel px-3 py-2 text-sm shadow-lg" onClick={() => update(c.key, { minimized: false })}>
        <span className="truncate font-medium">{c.subject || 'New message'}</span>
        <button className="rounded p-0.5 hover:bg-hover" onClick={(e) => { e.stopPropagation(); void closeAndKeep() }} aria-label="Close">
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto flex h-[560px] w-[640px] max-w-[calc(100vw-2rem)] flex-col rounded-t-lg border border-border bg-bg shadow-2xl">
      <div className="flex items-center justify-between rounded-t-lg bg-panel px-3 py-1.5 text-sm">
        <span className="truncate font-medium">{c.subject || 'New message'}</span>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 hover:bg-hover" onClick={() => update(c.key, { minimized: true })} aria-label="Minimize">
            <Minus className="size-3.5" />
          </button>
          <button className="rounded p-1 hover:bg-hover" onClick={() => void closeAndKeep()} aria-label="Close">
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3">
        <div className="flex items-center gap-2 border-b border-border py-1 text-sm">
          <span className="w-10 text-xs text-muted">From</span>
          <Select className="h-7 flex-1 border-0 bg-transparent px-0" value={c.identityId ?? ''} onChange={(e) => update(c.key, { identityId: e.target.value || null })}>
            {identities.data?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} &lt;{i.email}&gt;{account ? ` · ${account.displayName}` : ''}
              </option>
            ))}
          </Select>
          {!c.showCc && (
            <button className="text-xs text-muted hover:text-fg" onClick={() => update(c.key, { showCc: true })}>
              Cc
            </button>
          )}
          {!c.showBcc && (
            <button className="text-xs text-muted hover:text-fg" onClick={() => update(c.key, { showBcc: true })}>
              Bcc
            </button>
          )}
        </div>
        <RecipientInput label="To" value={c.to} onChange={(to) => update(c.key, { to })} autoFocus={!c.to.length} />
        {c.showCc && <RecipientInput label="Cc" value={c.cc} onChange={(cc) => update(c.key, { cc })} />}
        {c.showBcc && <RecipientInput label="Bcc" value={c.bcc} onChange={(bcc) => update(c.key, { bcc })} />}
        <input className="h-8 w-full border-b border-border bg-transparent text-sm outline-none placeholder:text-muted" placeholder="Subject" value={c.subject} onChange={(e) => update(c.key, { subject: e.target.value })} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} className="flex flex-1 flex-col" />
      </div>

      {c.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-3 py-2">
          {c.attachments.map((a) => (
            <span key={a.path} className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-0.5 text-xs">
              <Paperclip className="size-3 text-muted" />
              <span className="max-w-48 truncate" title={a.filename}>
                {a.filename}
              </span>
              <span className="text-muted">{formatBytes(a.size)}</span>
              <button className="text-muted hover:text-fg" onClick={() => update(c.key, { attachments: c.attachments.filter((x) => x.path !== a.path) })} aria-label="Remove">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <EditorToolbar editor={editor} />
      {error && <div className="px-3 py-1 text-xs text-danger">{error}</div>}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button variant="primary" onClick={() => send.mutate(undefined)} disabled={!canSend} loading={send.isPending}>
          <Send className="size-4" /> Send
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="Schedule send"
          disabled={!canSend}
          onClick={() => {
            const when = window.prompt('Send at (e.g. 2026-11-03 09:00)', new Date(Date.now() + 3600_000).toISOString().slice(0, 16).replace('T', ' '))
            if (!when) return
            const d = new Date(when)
            if (Number.isNaN(d.getTime()) || d.getTime() < Date.now()) return setError('Enter a future date/time')
            send.mutate(d.toISOString())
          }}
        >
          <Clock className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => pick.mutate()} title="Attach files">
          <Paperclip className="size-4" />
        </Button>
        <span className={cn('ml-auto text-xs text-muted', save.isPending && 'opacity-60')}>{save.isPending ? 'Saving…' : status}</span>
        <Button variant="ghost" size="sm" onClick={() => void discard()} title="Discard draft">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}
