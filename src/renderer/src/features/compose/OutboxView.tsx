import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Clock, FileEdit, RotateCw, Send, Trash2, Undo2 } from 'lucide-react'
import { invoke, onEvent } from '@renderer/lib/api'
import { Button } from '@renderer/components/ui'
import { formatFullDate } from '@renderer/lib/format'
import { useComposeActions } from './useComposeActions'

export function useOutbox() {
  const qc = useQueryClient()
  useEffect(() => onEvent('outbox.changed', () => qc.invalidateQueries({ queryKey: ['outbox'] })), [qc])
  return useQuery({ queryKey: ['outbox'], queryFn: () => invoke('outbox.list'), refetchInterval: 5000 })
}

export function OutboxView() {
  const qc = useQueryClient()
  const outbox = useOutbox()
  const drafts = useQuery({ queryKey: ['drafts'], queryFn: () => invoke('drafts.list', {}) })
  const { openDraft } = useComposeActions()
  const cancel = useMutation({ mutationFn: (id: string) => invoke('outbox.cancel', { id }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['outbox'] }); void qc.invalidateQueries({ queryKey: ['drafts'] }) } })
  const retry = useMutation({ mutationFn: (id: string) => invoke('outbox.retry', { id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['outbox'] }) })
  const discard = useMutation({ mutationFn: (id: string) => invoke('drafts.discard', { id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['drafts'] }) })

  return (
    <div className="flex-1 overflow-y-auto p-4 text-sm">
      <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Outbox</h2>
      {outbox.data?.length === 0 && <p className="mb-6 text-xs text-muted">Nothing waiting to send.</p>}
      <div className="mb-6 divide-y divide-border rounded-md border border-border">
        {outbox.data?.map((o) => (
          <div key={o.id} className="flex items-center gap-3 px-3 py-2">
            {o.status === 'failed' ? <AlertTriangle className="size-4 text-danger" /> : o.scheduledAt && new Date(o.scheduledAt).getTime() > Date.now() + 60_000 ? <Clock className="size-4 text-muted" /> : <Send className="size-4 text-muted" />}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{o.subject || '(no subject)'}</div>
              <div className="truncate text-xs text-muted">
                To {o.to.join(', ')} ·{' '}
                {o.status === 'failed' ? `Failed: ${o.lastError}` : o.status === 'sending' ? 'Sending…' : o.scheduledAt ? `Scheduled ${formatFullDate(o.scheduledAt)}` : 'Queued'}
              </div>
            </div>
            {o.status === 'failed' && (
              <Button size="sm" variant="ghost" onClick={() => retry.mutate(o.id)} title="Retry">
                <RotateCw className="size-3.5" />
              </Button>
            )}
            {o.status !== 'sending' && (
              <Button size="sm" variant="ghost" onClick={() => cancel.mutate(o.id)} title="Cancel and edit">
                <Undo2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase text-muted">Local drafts</h2>
      {drafts.data?.length === 0 && <p className="text-xs text-muted">No drafts.</p>}
      <div className="divide-y divide-border rounded-md border border-border">
        {drafts.data?.map((d) => (
          <div key={d.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-hover" onClick={() => openDraft(d.id)}>
            <FileEdit className="size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{d.subject || '(no subject)'}</div>
              <div className="truncate text-xs text-muted">
                {d.to.map((a) => a.name || a.address).join(', ') || 'No recipients'} · {formatFullDate(d.updatedAt)}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); discard.mutate(d.id) }} title="Discard">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** "Message sent — Undo" toast with countdown. */
export function UndoSendToast() {
  const qc = useQueryClient()
  const outbox = useOutbox()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const { openDraft } = useComposeActions()
  const pending = outbox.data?.filter((o) => o.undoUntil && new Date(o.undoUntil).getTime() > now && o.status === 'queued') ?? []
  const sentRecently = outbox.data?.filter((o) => o.status === 'sent') ?? []
  if (!pending.length && !sentRecently.length) return null
  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-50 -translate-x-1/2 space-y-2">
      {pending.map((o) => (
        <div key={o.id} className="flex items-center gap-3 rounded-md border border-border bg-panel px-3 py-2 text-sm shadow-lg">
          <span>Sending “{o.subject || '(no subject)'}” in {Math.max(0, Math.ceil((new Date(o.undoUntil!).getTime() - now) / 1000))}s</span>
          <Button
            size="sm"
            onClick={async () => {
              const d = await invoke('outbox.cancel', { id: o.id })
              void qc.invalidateQueries({ queryKey: ['outbox'] })
              if (d) void openDraft(d.id)
            }}
          >
            <Undo2 className="size-3.5" /> Undo
          </Button>
        </div>
      ))}
    </div>
  )
}
