import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, EyeOff, Plug, RefreshCw } from 'lucide-react'
import { invoke, onEvent } from '@renderer/lib/api'
import { Alert, Button, cn } from '@renderer/components/ui'

export function McpSettings() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: ['mcp.settings'], queryFn: () => invoke('mcp.settings.get') })
  const status = useQuery({ queryKey: ['mcp.status'], queryFn: () => invoke('mcp.status') })
  const snippets = useQuery({ queryKey: ['mcp.snippets', status.data?.url], queryFn: () => invoke('mcp.configSnippets') })
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const tools = useQuery({ queryKey: ['ai.tools'], queryFn: () => invoke('ai.tools.list') })
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => onEvent('mcp.status', (s) => qc.setQueryData(['mcp.status'], s)), [qc])

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => invoke('mcp.settings.set', patch),
    onSuccess: (s) => {
      qc.setQueryData(['mcp.settings'], s)
      void qc.invalidateQueries({ queryKey: ['mcp.status'] })
      void qc.invalidateQueries({ queryKey: ['mcp.snippets'] })
    }
  })
  const regen = useMutation({ mutationFn: () => invoke('mcp.token.regenerate'), onSuccess: (t) => { setToken(t); void qc.invalidateQueries({ queryKey: ['mcp.snippets'] }) } })
  const copy = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }
  if (!settings.data) return null
  const s = settings.data
  const st = status.data

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Plug className="size-4 text-accent" /> MCP server
        </h3>
        <p className="text-xs text-muted">
          Let Claude Desktop, Claude Code or any Model Context Protocol client read and act on your mail through the same tools the built-in assistant uses. Read-only tools run freely; tools that change mail ask you here unless you allow them for a client.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted">Option A — stdio (recommended)</h4>
        <p className="text-xs text-muted">The client launches Mail City in headless mode. Works even when the app isn't open. Because there is no window, only allow-listed write tools run.</p>
        <Snippet label="Claude Code" text={snippets.data?.claudeCodeStdio ?? ''} onCopy={copy} copied={copied} />
        <Snippet label="Claude Desktop (claude_desktop_config.json)" text={snippets.data?.claudeDesktopStdio ?? ''} onCopy={copy} copied={copied} />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted">Option B — localhost HTTP (while the app runs)</h4>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.httpEnabled} onChange={(e) => save.mutate({ httpEnabled: e.target.checked })} /> Serve MCP on 127.0.0.1 while Mail City is running
        </label>
        {st?.httpRunning && (
          <div className="space-y-2 text-xs">
            <div>
              Endpoint: <code className="rounded bg-hover px-1">{st.url}</code> · {st.sessions} connected session{st.sessions === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              <span>Bearer token:</span>
              <code className="rounded bg-hover px-1">{token ?? '••••••••••••••••'}</code>
              <Button size="sm" variant="ghost" onClick={async () => setToken(token ? null : await invoke('mcp.token.reveal'))}>
                {token ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => regen.mutate()} title="Regenerate (disconnects clients)">
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <Snippet label="Claude Code" text={snippets.data?.claudeCodeHttp ?? ''} onCopy={copy} copied={copied} />
            <Snippet label="Generic HTTP client config" text={snippets.data?.genericHttp ?? ''} onCopy={copy} copied={copied} />
            <Alert kind="warn">The token grants full access to your mail tools. Only paste it into clients on this computer.</Alert>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted">Accounts shared with MCP clients</h4>
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-1">
            <input type="radio" checked={s.accountIds.length === 0} onChange={() => save.mutate({ accountIds: [] })} /> All accounts
          </label>
          {accounts.data?.map((a) => (
            <label key={a.id} className="flex items-center gap-1">
              <input type="checkbox" checked={s.accountIds.includes(a.id)} onChange={(e) => save.mutate({ accountIds: e.target.checked ? [...s.accountIds, a.id] : s.accountIds.filter((x) => x !== a.id) })} /> {a.displayName}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase text-muted">Client permissions</h4>
        {Object.keys(s.clients).length === 0 && <p className="text-xs text-muted">No client has connected yet. Clients appear here after their first call.</p>}
        {Object.entries(s.clients).map(([name, c]) => (
          <div key={name} className="rounded border border-border p-2 text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium">{name}</span>
              <span className="text-muted">{c.lastSeenAt ? `last seen ${new Date(c.lastSeenAt).toLocaleString()}` : ''}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {tools.data
                ?.filter((t) => t.risk !== 'read')
                .map((t) => (
                  <label key={t.name} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={c.allowTools.includes(t.name)}
                      onChange={(e) => save.mutate({ clients: { ...s.clients, [name]: { ...c, allowTools: e.target.checked ? [...c.allowTools, t.name] : c.allowTools.filter((x) => x !== t.name) } } })}
                    />
                    <code>{t.name}</code>
                    <span className={cn('rounded px-1', t.risk === 'destructive' ? 'bg-danger/15 text-danger' : 'bg-hover text-muted')}>{t.risk}</span>
                  </label>
                ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

function Snippet({ label, text, onCopy, copied }: { label: string; text: string; onCopy: (k: string, t: string) => void; copied: string | null }) {
  if (!text) return null
  return (
    <div className="text-xs">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-muted">{label}</span>
        <button className="flex items-center gap-1 text-accent hover:underline" onClick={() => onCopy(label, text)}>
          <Copy className="size-3" /> {copied === label ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded border border-border bg-bg p-2">{text}</pre>
    </div>
  )
}

/** Global confirmation cards for MCP clients (they can call at any time). */
export function McpConfirmToasts() {
  const [items, setItems] = useState<{ id: string; client: string; tool: string; risk: string; summary: string }[]>([])
  useEffect(() => onEvent('mcp.confirm', (r) => setItems((l) => [...l, r])), [])
  const answer = async (id: string, a: boolean | 'always') => {
    setItems((l) => l.filter((x) => x.id !== id))
    await invoke('mcp.confirm', { id, answer: a })
  }
  if (!items.length) return null
  return (
    <div className="fixed right-4 top-4 z-50 w-96 space-y-2">
      {items.map((c) => (
        <div key={c.id} className={cn('rounded-md border bg-panel p-3 text-sm shadow-xl', c.risk === 'destructive' ? 'border-danger/60' : 'border-accent/60')}>
          <div className="mb-1 text-xs text-muted">
            MCP client <span className="font-medium text-fg">{c.client}</span> wants to run <code>{c.tool}</code>
          </div>
          <div className="mb-2">{c.summary}</div>
          <div className="flex gap-2">
            <Button size="sm" variant={c.risk === 'destructive' ? 'danger' : 'primary'} onClick={() => answer(c.id, true)}>
              Allow once
            </Button>
            <Button size="sm" onClick={() => answer(c.id, 'always')}>
              Always for {c.client}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => answer(c.id, false)}>
              Deny
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
