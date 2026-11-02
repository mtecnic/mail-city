import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, Wand2, Loader2 } from 'lucide-react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import { invoke } from '@renderer/lib/api'
import { Button, Input, cn } from '@renderer/components/ui'
import { useAiSettings } from '@renderer/features/settings/AiSettings'
import { useAiStream } from './useStream'

type Mode = 'write' | 'reply' | 'rewrite' | 'shorten' | 'expand' | 'formal' | 'friendly' | 'fix' | 'translate'

function textToHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** AI toolbar inside the compose window: draft from a prompt, rewrite the current text. */
export function ComposeAiBar({ editor, accountId, inReplyToMessageId }: { editor: TipTapEditor | null; accountId: string; inReplyToMessageId: string | null }) {
  const ai = useAiSettings()
  const [prompt, setPrompt] = useState('')
  const [open, setOpen] = useState(false)
  const stream = useAiStream()

  const run = useMutation({
    mutationFn: async (mode: Mode) => {
      if (!editor) return ''
      const draftText = editor.getText()
      // Only send the part above any quoted thread.
      const own = draftText.split(/\n(?:On .+ wrote:|-{5,} Forwarded message)/)[0] ?? draftText
      const id = stream.begin()
      try {
        const r = await invoke('ai.draft', {
          accountId,
          instruction: prompt,
          draftText: mode === 'write' || mode === 'reply' ? undefined : own,
          inReplyToMessageId: inReplyToMessageId ?? undefined,
          mode,
          language: mode === 'translate' ? prompt || 'English' : undefined,
          streamId: id
        })
        return r.text
      } finally {
        stream.end()
      }
    },
    onSuccess: (text) => {
      if (!editor || !text) return
      // Replace the user's own part, keep quoted material (anything from the first quote block on).
      const html = editor.getHTML()
      const quoteIdx = html.indexOf('<div class="mc-quote">')
      const quoted = quoteIdx >= 0 ? html.slice(quoteIdx) : ''
      editor.commands.setContent(textToHtml(text) + (quoted ? `<br>${quoted}` : ''))
      editor.commands.focus('start')
      setPrompt('')
    }
  })

  if (!ai.data?.enabled || !ai.data.providers.some((p) => p.enabled)) return null
  const hasText = !!editor?.getText().trim()
  const btn = (mode: Mode, label: string, disabled = false) => (
    <Button size="sm" variant="ghost" disabled={disabled || run.isPending} onClick={() => run.mutate(mode)}>
      {label}
    </Button>
  )

  return (
    <div className="border-t border-border px-2 py-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <button className={cn('flex items-center gap-1 rounded px-1.5 py-1 hover:bg-hover', open && 'bg-hover')} onClick={() => setOpen((o) => !o)}>
          <Sparkles className="size-3.5 text-accent" /> AI
        </button>
        {open && (
          <>
            {inReplyToMessageId && btn('reply', 'Draft reply')}
            {btn('fix', 'Fix grammar', !hasText)}
            {btn('shorten', 'Shorten', !hasText)}
            {btn('expand', 'Expand', !hasText)}
            {btn('formal', 'More formal', !hasText)}
            {btn('friendly', 'Friendlier', !hasText)}
            {run.isPending && <Loader2 className="size-3.5 animate-spin text-muted" />}
          </>
        )}
      </div>
      {open && (
        <div className="mt-1 flex items-center gap-1">
          <Input
            className="h-7 text-xs"
            placeholder={hasText ? 'Tell the AI how to change the draft… (or a language to translate into)' : 'What should this email say?'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && prompt.trim()) run.mutate(hasText ? (/^(translate|in )/i.test(prompt) ? 'translate' : 'rewrite') : inReplyToMessageId ? 'reply' : 'write')
            }}
          />
          <Button size="sm" variant="primary" disabled={!prompt.trim() || run.isPending} onClick={() => run.mutate(hasText ? 'rewrite' : inReplyToMessageId ? 'reply' : 'write')}>
            <Wand2 className="size-3.5" /> Go
          </Button>
        </div>
      )}
      {stream.streaming && stream.text && <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-panel px-2 py-1 text-muted">{stream.text}</div>}
      {run.error && <div className="mt-1 text-danger">{run.error.message}</div>}
    </div>
  )
}
