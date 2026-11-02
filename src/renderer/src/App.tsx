import { useQuery } from '@tanstack/react-query'
import { Inbox, Mail, Settings } from 'lucide-react'
import { invoke } from './lib/api'
import { useTheme } from './lib/theme'

export function App() {
  useTheme()
  const version = useQuery({ queryKey: ['app.version'], queryFn: () => invoke('app.version') })
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })

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
              {a.displayName}
            </div>
          ))}
          {accounts.data?.length === 0 && <p className="px-2 py-4 text-xs text-muted">No accounts yet.</p>}
        </nav>
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
          <span>v{version.data?.version ?? '…'}</span>
          <Settings className="size-4" />
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center text-muted">
        <p className="text-sm">Add an account to get started.</p>
      </main>
    </div>
  )
}
