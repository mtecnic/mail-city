import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, ShieldAlert, CalendarPlus, Package, Receipt, ListTodo, Link as LinkIcon, MailMinus, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { Button, cn } from '@renderer/components/ui'
import { useAiSettings } from '@renderer/features/settings/AiSettings'
import { useComposeActions } from '@renderer/features/compose/useComposeActions'
import { useCompose } from '@renderer/store/compose'
import type { MessageDetail } from '@shared/schemas/mail'

interface Extract {
  events?: { title: string; start: string; end: string | null; location: string | null; allDay: boolean }[]
  tasks?: { text: string; due: string | null }[]
  tracking?: { carrier: string | null; number: string; url: string | null }[]
  amounts?: { label: string; amount: number; currency: string; due: string | null }[]
  links?: { label: string; url: string }[]
}

export function MessageAiPanel({ m }: { m: MessageDetail }) {
  const ai = useAiSettings()
  const qc = useQueryClient()
  const [open, setOpen] = useState(true)
  const [summary, setSummary] = useState<string | null>(m.aiSummary)
  const [replies, setReplies] = useState<string[] | null>(null)
  const [phish, setPhish] = useState<{ risk: string; reasons: string[]; advice: string } | null>(null)
  const extract = (m.aiExtract ?? null) as Extract | null
  const { reply } = useComposeActions()
  const update = useCompose((s) => s.update)

  useEffect(() => {
    setSummary(m.aiSummary)
    setReplies(null)
    setPhish(null)
  }, [m.id, m.aiSummary])

  const summarize = useMutation({ mutationFn: () => invoke('ai.summarize', { messageId: m.id }), onSuccess: (r) => setSummary(r.summary) })
  const smart = useMutation({ mutationFn: () => invoke('ai.smartReplies', { messageId: m.id }), onSuccess: setReplies })
  const doExtract = useMutation({ mutationFn: () => invoke('ai.extract', { messageId: m.id }), onSuccess: () => qc.invalidateQueries({ queryKey: ['message', m.id] }) })
  const phishing = useMutation({ mutationFn: () => invoke('ai.phishing', { messageId: m.id }), onSuccess: setPhish })
  const unsub = useQuery({ queryKey: ['unsub', m.id], queryFn: () => invoke('ai.unsubscribe.options', { messageId: m.id }), enabled: !!m.listUnsubscribe || /unsubscribe/i.test(m.textHtml ?? '') })
  const runUnsub = useMutation({ mutationFn: (url: string) => invoke('ai.unsubscribe.run', { messageId: m.id, url }) })

  const useReply = async (text: string) => {
    await reply(m.id, 'reply')
    // The composer just opened is the last one; seed its editor via initialHtml by updating state.
    const latest = useCompose.getState().composers.at(-1)
    if (latest) update(latest.key, { initialHtml: `<p>${text}</p>${latest.initialHtml}` })
  }

  if (!ai.data?.enabled) return null
  const hasItems = extract && ((extract.events?.length ?? 0) + (extract.tasks?.length ?? 0) + (extract.tracking?.length ?? 0) + (extract.amounts?.length ?? 0) > 0)

  return (
    <div className="border-b border-border bg-panel/60 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-accent" />
        <span className="font-medium">AI</span>
        {m.aiCategory && <span className="rounded bg-hover px-1.5 py-0.5 text-muted">{m.aiCategory.replace('_', ' ')}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => summarize.mutate()} loading={summarize.isPending}>
            Summarize
          </Button>
          <Button size="sm" variant="ghost" onClick={() => smart.mutate()} loading={smart.isPending}>
            Quick replies
          </Button>
          <Button size="sm" variant="ghost" onClick={() => doExtract.mutate()} loading={doExtract.isPending}>
            Extract
          </Button>
          <Button size="sm" variant="ghost" onClick={() => phishing.mutate()} loading={phishing.isPending} title="Check for phishing">
            <ShieldAlert className="size-3.5" />
          </Button>
          <button className="rounded p-0.5 text-muted hover:bg-hover" onClick={() => setOpen((o) => !o)} aria-label="Toggle">
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {(summarize.error || smart.error || doExtract.error || phishing.error) && <div className="text-danger">{(summarize.error ?? smart.error ?? doExtract.error ?? phishing.error)?.message}</div>}
          {summary && <div className="whitespace-pre-wrap rounded border border-border bg-bg px-3 py-2">{summary}</div>}
          {replies && (
            <div className="flex flex-wrap gap-1.5">
              {replies.map((r) => (
                <button key={r} className="rounded-full border border-border bg-bg px-2.5 py-1 hover:bg-hover" onClick={() => void useReply(r)}>
                  {r}
                </button>
              ))}
            </div>
          )}
          {phish && (
            <div className={cn('rounded border px-3 py-2', phish.risk === 'high' ? 'border-danger/50 bg-danger/10' : phish.risk === 'medium' ? 'border-yellow-600/50 bg-yellow-600/10' : 'border-green-600/40 bg-green-600/10')}>
              <div className="font-medium">Phishing risk: {phish.risk}</div>
              <ul className="ml-4 list-disc">
                {phish.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {phish.advice && <div className="mt-1 text-muted">{phish.advice}</div>}
            </div>
          )}
          {hasItems && (
            <div className="flex flex-wrap gap-1.5">
              {extract!.events?.map((e, i) => (
                <Chip key={`e${i}`} icon={CalendarPlus} label={`${e.title} · ${fmtDate(e.start)}`} onClick={() => invoke('ai.extract.saveIcs', { messageId: m.id, index: i })} title="Save .ics" />
              ))}
              {extract!.tracking?.map((t, i) => (
                <Chip key={`t${i}`} icon={Package} label={`${t.carrier ?? 'Tracking'} ${t.number}`} onClick={() => t.url && invoke('app.openExternal', { url: t.url })} />
              ))}
              {extract!.amounts?.map((a, i) => (
                <Chip key={`a${i}`} icon={Receipt} label={`${a.label}: ${a.amount} ${a.currency}${a.due ? ` due ${fmtDate(a.due)}` : ''}`} />
              ))}
              {extract!.tasks?.map((t, i) => (
                <Chip key={`k${i}`} icon={ListTodo} label={`${t.text}${t.due ? ` · ${fmtDate(t.due)}` : ''}`} />
              ))}
              {extract!.links?.slice(0, 3).map((l, i) => (
                <Chip key={`l${i}`} icon={LinkIcon} label={l.label} onClick={() => invoke('app.openExternal', { url: l.url })} />
              ))}
            </div>
          )}
          {unsub.data && unsub.data.length > 0 && (
            <div className="flex items-center gap-2">
              <MailMinus className="size-3.5 text-muted" />
              <span className="text-muted">Mailing list.</span>
              <Button size="sm" variant="ghost" onClick={() => runUnsub.mutate(unsub.data![0]!.url)} loading={runUnsub.isPending}>
                Unsubscribe{unsub.data[0]!.kind === 'one-click' ? ' (one click)' : unsub.data[0]!.kind === 'mailto' ? ' (sends email)' : ' (opens page)'}
              </Button>
              {runUnsub.data && <span className={runUnsub.data.ok ? 'text-green-600' : 'text-danger'}>{runUnsub.data.ok ? 'Done' : 'Failed'}</span>}
            </div>
          )}
          {(summarize.isPending || smart.isPending || doExtract.isPending || phishing.isPending) && (
            <div className="flex items-center gap-1 text-muted">
              <Loader2 className="size-3 animate-spin" /> Working…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ icon: Icon, label, onClick, title }: { icon: typeof CalendarPlus; label: string; onClick?: () => unknown; title?: string }) {
  return (
    <button className={cn('flex max-w-xs items-center gap-1 truncate rounded-full border border-border bg-bg px-2.5 py-1', onClick && 'hover:bg-hover')} onClick={onClick} title={title ?? label}>
      <Icon className="size-3 shrink-0 text-accent" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: /T\d{2}:\d{2}/.test(iso) ? 'short' : undefined })
}
