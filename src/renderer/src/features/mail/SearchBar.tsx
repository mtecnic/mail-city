import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, Save } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { useUi } from '@renderer/store/ui'
import { cn } from '@renderer/components/ui'

export function SearchBar() {
  const { mailbox, setMailbox } = useUi()
  const qc = useQueryClient()
  const [text, setText] = useState(mailbox.kind === 'search' ? mailbox.query : '')
  const saved = useQuery({ queryKey: ['savedSearches'], queryFn: () => invoke('search.saved.list') })
  const setSaved = useMutation({ mutationFn: (list: { id: string; name: string; query: string }[]) => invoke('search.saved.set', list), onSuccess: () => qc.invalidateQueries({ queryKey: ['savedSearches'] }) })

  useEffect(() => {
    if (mailbox.kind !== 'search') setText('')
  }, [mailbox])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable="true"], .ProseMirror')) {
        e.preventDefault()
        document.getElementById('mail-search')?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const run = () => {
    const q = text.trim()
    if (q) setMailbox({ kind: 'search', query: q })
  }
  const clear = () => {
    setText('')
    setMailbox({ kind: 'unified', specialUse: 'inbox' })
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <div className={cn('flex h-8 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-2', mailbox.kind === 'search' && 'border-accent')}>
        <Search className="size-3.5 shrink-0 text-muted" />
        <input
          id="mail-search"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          placeholder="Search  (from: to: subject: has:attachment is:unread in: before: after:)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run()
            if (e.key === 'Escape') {
              clear()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        {text && (
          <button className="text-muted hover:text-fg" onClick={clear} aria-label="Clear">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {mailbox.kind === 'search' && (
        <button
          className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg"
          title="Save search"
          onClick={() => {
            const name = window.prompt('Name this search', text.slice(0, 40))
            if (!name) return
            setSaved.mutate([...(saved.data ?? []), { id: `ss_${Date.now().toString(36)}`, name, query: text.trim() }])
          }}
        >
          <Save className="size-4" />
        </button>
      )}
    </div>
  )
}
