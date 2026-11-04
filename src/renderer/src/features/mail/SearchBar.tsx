import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X, Save } from 'lucide-react'
import { invoke } from '@renderer/lib/api'
import { useUi, type MailboxSelection } from '@renderer/store/ui'
import { cn } from '@renderer/components/ui'
import { promptDialog } from '@renderer/components/dialogs'
import { useFolders } from './hooks'

export function SearchBar() {
  const { mailbox, setMailbox } = useUi()
  const qc = useQueryClient()
  const [text, setText] = useState(mailbox.kind === 'search' ? mailbox.query : '')
  const saved = useQuery({ queryKey: ['savedSearches'], queryFn: () => invoke('search.saved.list') })
  const folders = useFolders()
  const setSaved = useMutation({ mutationFn: (list: { id: string; name: string; query: string }[]) => invoke('search.saved.set', list), onSuccess: () => qc.invalidateQueries({ queryKey: ['savedSearches'] }) })

  // The mailbox a search runs inside; set when typing begins, restored when the box is cleared.
  const within = useRef<MailboxSelection | null>(mailbox.kind === 'search' ? (mailbox.within ?? null) : mailbox)
  useEffect(() => {
    if (mailbox.kind !== 'search') {
      within.current = mailbox
      setText('')
    } else {
      if (mailbox.within !== undefined) within.current = mailbox.within
      // A saved search (or a search opened elsewhere) fills the box unless the user is typing in it.
      if (document.activeElement?.id !== 'mail-search') setText(mailbox.query)
    }
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

  const apply = (raw: string) => {
    const q = raw.trim()
    const cur = useUi.getState().mailbox // not the render-time value: this runs from a timer
    if (q) {
      if (cur.kind !== 'search' || cur.query !== q) setMailbox({ kind: 'search', query: q, within: within.current })
    } else if (cur.kind === 'search') setMailbox(within.current ?? { kind: 'unified', specialUse: 'inbox' })
  }
  // Live search: apply after a short pause in typing; Enter applies immediately.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onChange = (v: string) => {
    setText(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => apply(v), 250)
  }
  const run = () => {
    if (timer.current) clearTimeout(timer.current)
    apply(text)
  }
  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    setText('')
    apply('')
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const scopeName = (() => {
    const w = mailbox.kind === 'search' ? mailbox.within : mailbox
    return w?.kind === 'folder' ? (folders.data?.find((f) => f.id === w.folderId)?.name ?? null) : null
  })()

  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <div className={cn('flex h-8 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-2', mailbox.kind === 'search' && 'border-accent')}>
        <Search className="size-3.5 shrink-0 text-muted" />
        <input
          id="mail-search"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          placeholder={scopeName ? `Search in ${scopeName}  (from: to: subject: is:unread …)` : 'Search everywhere  (from: to: subject: has:attachment is:unread in: before: after:)'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
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
          onClick={async () => {
            const name = await promptDialog({ title: 'Save search', label: 'Name', defaultValue: text.slice(0, 40), okLabel: 'Save' })
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
