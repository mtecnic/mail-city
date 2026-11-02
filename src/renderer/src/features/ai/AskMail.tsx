import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { useUi } from '@renderer/store/ui'
import { useAiStream } from './useStream'

/** "Ask my mail" answer card shown above search results. */
export function AskMailCard({ question }: { question: string }) {
  const { selectMessage } = useUi()
  const stream = useAiStream()
  const [result, setResult] = useState<{ answer: string; sources: { n: number; id: string; subject: string; from: string; date: string }[] } | null>(null)
  const ask = useMutation({
    mutationFn: async () => {
      const id = stream.begin()
      try {
        return await invoke('ai.askMail', { question, streamId: id })
      } finally {
        stream.end()
      }
    },
    onSuccess: setResult
  })

  if (!result && !ask.isPending) {
    return (
      <div className="border-b border-border px-3 py-1.5 text-xs">
        <button className="flex items-center gap-1 text-accent hover:underline" onClick={() => ask.mutate()}>
          <Sparkles className="size-3.5" /> Ask AI: “{question}”
        </button>
        {ask.error && <div className="text-danger">{ask.error.message}</div>}
      </div>
    )
  }
  return (
    <div className="border-b border-border bg-panel/60 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-1 font-medium">
        <Sparkles className="size-3.5 text-accent" /> Answer {ask.isPending && <Loader2 className="size-3 animate-spin text-muted" />}
      </div>
      <div className="whitespace-pre-wrap">{result?.answer ?? stream.text}</div>
      {result && result.sources.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {result.sources.map((s) => (
            <button key={s.id} className="rounded border border-border bg-bg px-1.5 py-0.5 hover:bg-hover" title={`${s.from} · ${s.subject}`} onClick={() => selectMessage(s.id)}>
              [{s.n}] {s.subject.slice(0, 30) || '(no subject)'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
