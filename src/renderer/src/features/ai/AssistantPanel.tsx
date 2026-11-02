import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Check, Loader2, Plus, Send, Square, Trash2, Wrench, X, AlertTriangle } from 'lucide-react'
import { invoke, onEvent } from '@renderer/lib/api'
import { Button, cn } from '@renderer/components/ui'
import { useUi } from '@renderer/store/ui'
import { useAiSettings } from '@renderer/features/settings/AiSettings'
import type { ChannelOutput } from '@shared/ipc'

type Session = NonNullable<ChannelOutput<'agent.session.get'>>
type Ev = Session['transcript'][number]

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const ai = useAiSettings()
  const { selectedMessageId, mailbox, selectMessage, setMailbox } = useUi()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [live, setLive] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirms, setConfirms] = useState<{ id: string; tool: string; risk: string; summary: string }[]>([])
  const [input, setInput] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const sessions = useQuery({ queryKey: ['agent.sessions'], queryFn: () => invoke('agent.sessions.list') })

  const create = useMutation({
    mutationFn: () => invoke('agent.session.create', { accountId: mailbox.kind === 'folder' ? mailbox.accountId : undefined, messageId: selectedMessageId ?? undefined }),
    onSuccess: (s) => {
      setSessionId(s.id)
      setEvents(s.transcript)
      void qc.invalidateQueries({ queryKey: ['agent.sessions'] })
    }
  })
  const load = async (id: string) => {
    const s = await invoke('agent.session.get', { id })
    if (s) {
      setSessionId(s.id)
      setEvents(s.transcript)
    }
  }
  const remove = useMutation({
    mutationFn: (id: string) => invoke('agent.session.remove', { id }),
    onSuccess: () => {
      setSessionId(null)
      setEvents([])
      void qc.invalidateQueries({ queryKey: ['agent.sessions'] })
    }
  })

  useEffect(() => {
    const offs = [
      onEvent('agent.event', (e) => {
        if (e.sessionId !== sessionId) return
        setEvents((evs) => [...evs, e.event])
        if (e.event.type === 'assistant') setLive('')
      }),
      onEvent('agent.delta', (e) => {
        if (e.sessionId !== sessionId) return
        const d = e.delta
        if (d.type === 'text') setLive((t) => t + d.text)
      }),
      onEvent('agent.done', (e) => {
        if (e.sessionId !== sessionId) return
        setBusy(false)
        setLive('')
        void qc.invalidateQueries({ queryKey: ['agent.sessions'] })
        void qc.invalidateQueries({ queryKey: ['messages'] })
      }),
      onEvent('agent.confirm', (e) => {
        if (e.sessionId !== sessionId) return
        setConfirms((c) => [...c, { id: e.id, tool: e.tool, risk: e.risk, summary: e.summary }])
      }),
      onEvent('drafts.created', () => qc.invalidateQueries({ queryKey: ['drafts'] }))
    ]
    return () => offs.forEach((f) => f())
  }, [sessionId, qc])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [events, live])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    let id = sessionId
    if (!id) {
      const s = await create.mutateAsync()
      id = s.id
    }
    setInput('')
    setBusy(true)
    await invoke('agent.send', { sessionId: id, text })
  }
  const answer = async (id: string, ok: boolean) => {
    setConfirms((c) => c.filter((x) => x.id !== id))
    await invoke('agent.confirm', { id, ok })
  }

  const openUri = (text: string) => {
    const m = text.match(/mail:\/\/msg\/([A-Za-z0-9_]+)/)
    if (m) selectMessage(m[1]!)
    const d = text.match(/mail:\/\/draft\/([A-Za-z0-9_]+)/)
    if (d) setMailbox({ kind: 'outbox' })
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-border bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <Bot className="size-4 text-accent" />
        <span className="font-semibold">Assistant</span>
        <select className="ml-auto h-7 max-w-40 rounded border border-border bg-bg px-1 text-xs" value={sessionId ?? ''} onChange={(e) => (e.target.value ? void load(e.target.value) : create.mutate())}>
          <option value="">New conversation</option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title || 'Untitled'}
            </option>
          ))}
        </select>
        <button className="rounded p-1 hover:bg-hover" title="New" onClick={() => create.mutate()}>
          <Plus className="size-3.5" />
        </button>
        {sessionId && (
          <button className="rounded p-1 hover:bg-hover" title="Delete conversation" onClick={() => remove.mutate(sessionId)}>
            <Trash2 className="size-3.5" />
          </button>
        )}
        <button className="rounded p-1 hover:bg-hover" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {!ai.data?.enabled || ai.data.providers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted">Set up an AI provider in Settings → AI to use the assistant.</div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          {events.length === 0 && !live && (
            <div className="space-y-2 text-xs text-muted">
              <p>Ask anything about your mail, or tell me what to do. I can search, read, summarize, draft replies, file messages and create rules. Changes always ask for your confirmation.</p>
              <div className="flex flex-wrap gap-1">
                {['What needs a reply today?', 'Summarize this thread', 'Find the last invoice from Acme and draft a payment confirmation', 'Archive all newsletters older than a week'].map((s) => (
                  <button key={s} className="rounded-full border border-border bg-bg px-2 py-1 hover:bg-hover" onClick={() => setInput(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {events.map((e, i) => (
            <EventView key={i} e={e} onOpen={openUri} />
          ))}
          {live && <div className="whitespace-pre-wrap rounded-md bg-bg px-3 py-2">{live}</div>}
          {busy && !live && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
          {confirms.map((c) => (
            <div key={c.id} className={cn('rounded-md border px-3 py-2 text-xs', c.risk === 'destructive' ? 'border-danger/50 bg-danger/10' : 'border-accent/50 bg-accent/10')}>
              <div className="mb-1 flex items-center gap-1 font-medium">
                <AlertTriangle className="size-3.5" /> Allow this action?
              </div>
              <div className="mb-2">{c.summary}</div>
              <div className="flex gap-2">
                <Button size="sm" variant={c.risk === 'destructive' ? 'danger' : 'primary'} onClick={() => answer(c.id, true)}>
                  <Check className="size-3.5" /> Allow
                </Button>
                <Button size="sm" onClick={() => answer(c.id, false)}>
                  <X className="size-3.5" /> Deny
                </Button>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}

      <div className="border-t border-border p-2">
        <div className="flex items-end gap-1">
          <textarea
            className="max-h-32 min-h-9 flex-1 resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
            placeholder="Ask about your mail or give an instruction…"
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          {busy ? (
            <Button size="sm" variant="ghost" onClick={() => sessionId && invoke('agent.cancel', { sessionId })} title="Stop">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void send()} disabled={!input.trim()}>
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}

function EventView({ e, onOpen }: { e: Ev; onOpen: (text: string) => void }) {
  switch (e.type) {
    case 'user':
      return <div className="ml-8 whitespace-pre-wrap rounded-md bg-accent/15 px-3 py-2">{e.text}</div>
    case 'assistant':
      return (
        <div className="whitespace-pre-wrap rounded-md bg-bg px-3 py-2" onClick={() => onOpen(e.text)}>
          {linkify(e.text, onOpen)}
        </div>
      )
    case 'tool_call':
      return (
        <div className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs text-muted">
          <Wrench className="size-3" /> {e.summary}
        </div>
      )
    case 'tool_result':
      return (
        <div className={cn('ml-5 truncate text-xs', e.ok ? 'text-muted' : e.declined ? 'text-yellow-600' : 'text-danger')} title={e.text}>
          {e.ok ? `→ ${e.text.slice(0, 120)}` : e.declined ? 'Declined' : `Error: ${e.text.slice(0, 160)}`}
        </div>
      )
    case 'thinking':
      return null
    case 'error':
      return <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">{e.text}</div>
  }
}

function linkify(text: string, onOpen: (t: string) => void) {
  const parts = text.split(/(mail:\/\/(?:msg|draft)\/[A-Za-z0-9_]+)/g)
  return parts.map((p, i) =>
    /^mail:\/\//.test(p) ? (
      <button key={i} className="text-accent underline" onClick={(ev) => { ev.stopPropagation(); onOpen(p) }}>
        {p.startsWith('mail://draft') ? 'open draft' : 'open message'}
      </button>
    ) : (
      <span key={i}>{p}</span>
    )
  )
}
