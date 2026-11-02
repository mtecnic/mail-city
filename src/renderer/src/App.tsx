import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Inbox, Mail, Plus, Settings } from 'lucide-react'
import { invoke, useInvalidateOn } from './lib/api'
import { useTheme } from './lib/theme'
import { SettingsPage } from './features/settings/SettingsPage'
import { AddAccountDialog } from './features/accounts/AddAccountDialog'
import { Button } from './components/ui'

type View = { kind: 'mail' } | { kind: 'settings' }

export function App() {
  useTheme()
  const [view, setView] = useState<View>({ kind: 'mail' })
  const [adding, setAdding] = useState(false)
  const version = useQuery({ queryKey: ['app.version'], queryFn: () => invoke('app.version') })
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  useInvalidateOn('accounts.changed', [['accounts.list']])

  if (view.kind === 'settings') return <SettingsPage onBack={() => setView({ kind: 'mail' })} />

  return (
    <div className="flex h-screen w-screen select-none">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 px-4 py-3 text-sm font-semibold">
          <Mail className="size-4 text-accent" /> Mail City
        </div>
        <nav className="flex-1 space-y-1 px-2 text-sm">
          <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover">
            <Inbox className="size-4" /> Unified inbox
          </div>
          {accounts.data?.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-hover">
              <span className="size-2 rounded-full" style={{ background: a.color }} />
              <span className="truncate">{a.displayName}</span>
            </div>
          ))}
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-muted hover:bg-hover hover:text-fg" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add account
          </button>
        </nav>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
          <span>v{version.data?.version ?? '…'}</span>
          <button className="rounded p-1 hover:bg-hover" onClick={() => setView({ kind: 'settings' })} aria-label="Settings">
            <Settings className="size-4" />
          </button>
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
        {accounts.data?.length === 0 ? (
          <>
            <p className="text-sm">Add an account to get started.</p>
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add account
            </Button>
          </>
        ) : (
          <p className="text-sm">Select a folder.</p>
        )}
      </main>
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  )
}
