import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Cpu, Download, Loader2, Plus, RefreshCw, Search, Sparkles, Trash2, X, Zap, Eye, Braces, Wrench, Database } from 'lucide-react'
import { invoke, onEvent } from '@renderer/lib/api'
import { Alert, Button, Field, Input, Select, cn } from '@renderer/components/ui'
import type { AiFeature, AiModelInfo, AiProviderConfig, AiSettings as AiSettingsT, LocalServerProbe } from '@shared/schemas/ai'

const FEATURES: [AiFeature, string, string][] = [
  ['chat', 'Assistant / agent', 'Needs tool calling'],
  ['drafting', 'Drafting & replies', 'Best quality model'],
  ['summarize', 'Summaries', 'Fast model is fine'],
  ['triage', 'Triage & categories', 'Small fast model, runs on every new email'],
  ['extract', 'Extraction (events, tracking…)', 'Needs JSON output'],
  ['embeddings', 'Semantic search embeddings', 'An embedding model']
]

const KIND_LABEL: Record<string, string> = { ollama: 'Ollama', vllm: 'vLLM', llamacpp: 'llama.cpp', lmstudio: 'LM Studio', tgi: 'Text Generation Inference', localai: 'LocalAI', litellm: 'LiteLLM', koboldcpp: 'KoboldCpp', textgen: 'text-generation-webui', 'openai-compat': 'OpenAI-compatible server' }

export function useAiSettings() {
  const qc = useQueryClient()
  useEffect(() => onEvent('ai.settings.changed', (s) => qc.setQueryData(['ai.settings'], s)), [qc])
  return useQuery({ queryKey: ['ai.settings'], queryFn: () => invoke('ai.settings.get') })
}

export function AiSettings() {
  const qc = useQueryClient()
  const s = useAiSettings()
  const accounts = useQuery({ queryKey: ['accounts.list'], queryFn: () => invoke('accounts.list') })
  const save = useMutation({ mutationFn: (patch: Record<string, unknown>) => invoke('ai.settings.set', patch), onSuccess: (next) => qc.setQueryData(['ai.settings'], next) })
  const [addingLocal, setAddingLocal] = useState(false)
  const [addingClaude, setAddingClaude] = useState(false)
  if (!s.data) return null
  const v = s.data
  const hasClaude = v.providers.some((p) => p.kind === 'anthropic')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-accent" /> AI
          </h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.enabled} onChange={(e) => save.mutate({ enabled: e.target.checked })} /> Enabled
          </label>
        </div>
        <p className="text-xs text-muted">
          Mail City works with Claude (cloud) and with any local model server — Ollama, vLLM, llama.cpp, LM Studio and friends. Every feature can be routed to a different model, and privacy rules decide what may leave this PC.
        </p>
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted">Privacy</h4>
        <Field label="Default policy">
          <Select value={v.privacy.mode} onChange={(e) => save.mutate({ privacy: { mode: e.target.value } })}>
            <option value="cloud-allowed">Cloud allowed — Claude may read mail content when routed</option>
            <option value="local-only">Local only — never send mail content to a cloud API</option>
          </Select>
        </Field>
        {accounts.data && accounts.data.length > 0 && (
          <div className="space-y-1 text-xs">
            <div className="text-muted">Per-account overrides</div>
            {accounts.data.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: a.color }} />
                <span className="w-56 truncate">{a.displayName}</span>
                <Select className="h-7 w-48" value={v.privacy.perAccount[a.id] ?? 'cloud-allowed'} onChange={(e) => save.mutate({ privacy: { perAccount: { ...v.privacy.perAccount, [a.id]: e.target.value } } })}>
                  <option value="cloud-allowed">Follow default</option>
                  <option value="local-only">Local only</option>
                </Select>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase text-muted">Providers</h4>
          <div className="flex gap-2">
            {!hasClaude && (
              <Button size="sm" onClick={() => setAddingClaude(true)}>
                <Plus className="size-3.5" /> Claude (Anthropic)
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => setAddingLocal(true)}>
              <Plus className="size-3.5" /> Local server
            </Button>
          </div>
        </div>
        {v.providers.length === 0 && <Alert kind="info">No providers yet. Add Claude with an API key, or scan this machine for Ollama / LM Studio / llama.cpp.</Alert>}
        {v.providers.map((p) => (
          <ProviderCard key={p.id} p={p} />
        ))}
        {addingClaude && <AddClaude onClose={() => setAddingClaude(false)} />}
        {addingLocal && <AddLocalServer onClose={() => setAddingLocal(false)} />}
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase text-muted">Routing</h4>
        <div className="space-y-2">
          {FEATURES.map(([f, label, hint]) => (
            <div key={f} className="grid grid-cols-[14rem_1fr] items-center gap-3 text-sm">
              <div>
                <div>{label}</div>
                <div className="text-xs text-muted">{hint}</div>
              </div>
              <RouteSelect settings={v} feature={f} onChange={(r) => save.mutate({ routes: { [f]: r } })} />
            </div>
          ))}
        </div>
        <div className="grid max-w-md gap-3 pt-2">
          <Field label="Claude effort" hint="Higher effort = deeper reasoning, more tokens">
            <Select value={v.effort} onChange={(e) => save.mutate({ effort: e.target.value })}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.autoTriage} onChange={(e) => save.mutate({ autoTriage: e.target.checked })} /> Triage new mail automatically (category, priority)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.autoIndex} onChange={(e) => save.mutate({ autoIndex: e.target.checked })} /> Build semantic search index in the background
          </label>
        </div>
      </section>

      <ToolPermissions settings={v} onChange={(list) => save.mutate({ autoApproveTools: list })} />
      <RunLog />
    </div>
  )
}

function RouteSelect({ settings, feature, onChange }: { settings: AiSettingsT; feature: AiFeature; onChange: (r: { providerId: string; model: string } | null) => void }) {
  const cur = settings.routes[feature]
  const value = cur ? `${cur.providerId}::${cur.model}` : ''
  const options = settings.providers.flatMap((p) => {
    const models = p.kind === 'anthropic' && !p.models.length ? [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }] : p.models
    return models
      .filter((m) => (feature === 'embeddings' ? m.id.match(/embed|bge|e5-|minilm|nomic/i) || (m as AiModelInfo).capabilities?.embeddings : !(m as AiModelInfo).capabilities?.embeddings || p.kind === 'anthropic'))
      .map((m) => ({ key: `${p.id}::${m.id}`, label: `${p.label} · ${m.label || m.id}` }))
  })
  return (
    <Select
      value={value}
      onChange={(e) => {
        const [providerId, model] = e.target.value.split('::')
        onChange(providerId && model ? { providerId, model } : null)
      }}
    >
      <option value="">Automatic</option>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </Select>
  )
}

function ProviderCard({ p }: { p: AiProviderConfig }) {
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['ai.settings'] }), [qc])
  const health = useMutation({ mutationFn: () => invoke('ai.provider.health', { id: p.id }), onSuccess: refresh })
  const models = useMutation({ mutationFn: () => invoke('ai.models.list', { providerId: p.id }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: () => invoke('ai.provider.remove', { id: p.id }), onSuccess: refresh })
  const setKeyM = useMutation({ mutationFn: (k: string | null) => invoke('ai.provider.setKey', { id: p.id, apiKey: k }), onSuccess: () => { setKey(''); void refresh() } })
  const probe = useMutation({ mutationFn: (model: string) => invoke('ai.models.probe', { providerId: p.id, model }), onSuccess: refresh })
  const suggest = useMutation({
    mutationFn: async () => {
      const routes = await invoke('ai.suggestRoutes', { providerId: p.id })
      await invoke('ai.settings.set', { routes })
    },
    onSuccess: refresh
  })
  const [pull, setPull] = useState<Record<string, { status: string; pct?: number; error?: string }>>({})
  useEffect(
    () =>
      onEvent('ai.pullProgress', (e) => {
        if (e.providerId !== p.id) return
        setPull((s) => ({ ...s, [e.model]: { status: e.done ? (e.error ? 'error' : 'done') : e.status, pct: e.total ? Math.round(((e.completed ?? 0) / e.total) * 100) : undefined, error: e.error } }))
        if (e.done) void refresh()
      }),
    [p.id, refresh]
  )

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        {p.kind === 'anthropic' ? <Sparkles className="size-4 text-accent" /> : <Cpu className="size-4 text-accent" />}
        <div className="flex-1">
          <div className="text-sm font-medium">
            {p.label} {p.version && <span className="text-xs text-muted">v{p.version}</span>}
          </div>
          <div className="text-xs text-muted">
            {p.kind === 'anthropic' ? 'api.anthropic.com · cloud' : `${p.baseUrl} · ${KIND_LABEL[p.serverKind ?? 'openai-compat']} · local`}
            {p.lastError && <span className="ml-2 text-danger">{p.lastError}</span>}
            {!p.lastError && p.lastSeenAt && <span className="ml-2 text-green-600">online</span>}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => health.mutate()} loading={health.isPending} title="Check connection">
          <RefreshCw className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => models.mutate()} loading={models.isPending} title="Refresh models">
          Models
        </Button>
        <Button size="sm" variant="ghost" onClick={() => suggest.mutate()} loading={suggest.isPending} title="Assign this provider's models to every feature">
          Use for everything
        </Button>
        <Button size="sm" variant="ghost" onClick={() => remove.mutate()} aria-label="Remove">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {(p.kind === 'anthropic' || p.serverKind === 'vllm' || p.serverKind === 'litellm' || p.serverKind === 'openai-compat' || p.serverKind === 'lmstudio') && (
        <div className="flex items-center gap-2">
          <Input type="password" className="max-w-sm" placeholder={p.hasApiKey ? '•••••••• (key stored)' : 'API key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <Button size="sm" onClick={() => setKeyM.mutate(key)} disabled={!key}>
            Save key
          </Button>
          {p.hasApiKey && (
            <Button size="sm" variant="ghost" onClick={() => setKeyM.mutate(null)}>
              Remove key
            </Button>
          )}
        </div>
      )}

      {p.models.length > 0 && (
        <div className="divide-y divide-border rounded border border-border">
          {p.models.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <span className="w-56 truncate font-medium" title={m.id}>
                {m.label || m.id}
              </span>
              <span className="w-28 text-muted">{[m.parameterSize, m.quantization].filter(Boolean).join(' · ')}</span>
              <CapBadges m={m} />
              <span className="ml-auto flex items-center gap-1">
                {pull[m.id] && pull[m.id]!.status !== 'done' && <span className="text-muted">{pull[m.id]!.status} {pull[m.id]!.pct !== undefined ? `${pull[m.id]!.pct}%` : ''}</span>}
                {p.kind !== 'anthropic' && (
                  <Button size="sm" variant="ghost" onClick={() => probe.mutate(m.id)} loading={probe.isPending && probe.variables === m.id} title="Probe capabilities & speed">
                    <Zap className="size-3.5" />
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {p.serverKind === 'ollama' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Pull recommended:</span>
          {(
            [
              ['llama3.2:3b', 'fast triage'],
              ['qwen2.5:7b', 'drafting + tools'],
              ['nomic-embed-text', 'embeddings']
            ] as [string, string][]
          ).map(([name, why]) => (
            <Button key={name} size="sm" variant="ghost" disabled={p.models.some((m) => m.id === name) || !!pull[name]} onClick={() => { setPull((s) => ({ ...s, [name]: { status: 'starting' } })); void invoke('ai.models.pull', { providerId: p.id, model: name }) }}>
              <Download className="size-3.5" /> {name} <span className="text-muted">({why})</span>
            </Button>
          ))}
          {Object.entries(pull).filter(([, v]) => v.status !== 'done').map(([name, v]) => (
            <span key={name} className="text-muted">
              {name}: {v.error ?? v.status} {v.pct !== undefined ? `${v.pct}%` : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function CapBadges({ m }: { m: AiModelInfo }) {
  const c = m.capabilities
  const badge = (ok: boolean | null, Icon: typeof Wrench, label: string) => (
    <span className={cn('flex items-center gap-0.5 rounded px-1', ok === true ? 'bg-green-600/15 text-green-600' : ok === false ? 'bg-hover text-muted line-through' : 'bg-hover text-muted')} title={`${label}: ${ok === null ? 'unknown (probe to check)' : ok ? 'yes' : 'no'}`}>
      <Icon className="size-3" /> {label}
    </span>
  )
  return (
    <span className="flex items-center gap-1">
      {badge(c.tools, Wrench, 'tools')}
      {badge(c.json, Braces, 'JSON')}
      {badge(c.vision, Eye, 'vision')}
      {badge(c.embeddings, Database, 'embed')}
      {c.contextTokens && <span className="rounded bg-hover px-1 text-muted">{Math.round(c.contextTokens / 1024)}k ctx</span>}
      {c.tokensPerSecond && <span className="rounded bg-hover px-1 text-muted">~{c.tokensPerSecond} tok/s</span>}
    </span>
  )
}

function AddClaude({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const add = useMutation({
    mutationFn: async () => {
      const p = await invoke('ai.provider.upsert', { kind: 'anthropic', label: 'Claude', apiKey: key })
      await invoke('ai.models.list', { providerId: p.id }).catch(() => [])
      const routes = await invoke('ai.suggestRoutes', { providerId: p.id })
      const cur = await invoke('ai.settings.get')
      // Only fill routes that are still automatic.
      const fill: Record<string, unknown> = {}
      for (const [k, r] of Object.entries(routes)) if (!cur.routes[k as AiFeature] && k !== 'embeddings') fill[k] = r
      if (Object.keys(fill).length) await invoke('ai.settings.set', { routes: fill })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai.settings'] })
      onClose()
    }
  })
  return (
    <div className="space-y-2 rounded-md border border-accent/40 p-3">
      <div className="text-sm font-medium">Add Claude</div>
      <p className="text-xs text-muted">
        Get an API key at console.anthropic.com. Mail content is only sent when a feature is routed to Claude and the privacy policy allows it. Default model: Claude Opus 5.5.
      </p>
      <div className="flex gap-2">
        <Input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
        <Button variant="primary" onClick={() => add.mutate()} disabled={!key} loading={add.isPending}>
          Add
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {add.error && <Alert kind="error">{add.error.message}</Alert>}
    </div>
  )
}

function AddLocalServer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [results, setResults] = useState<LocalServerProbe[] | null>(null)
  const [manual, setManual] = useState(false)
  const scan = useMutation({
    mutationFn: (text: string) => invoke('ai.discoverLocal', { input: text, apiKey: apiKey || undefined }),
    onSuccess: (r) => setResults(r)
  })
  const add = useMutation({
    mutationFn: async (r: LocalServerProbe) => {
      const p = await invoke('ai.provider.upsert', {
        kind: 'openai-compat',
        label: `${KIND_LABEL[r.kind] ?? r.kind} (${new URL(r.baseUrl).host})`,
        baseUrl: r.baseUrl,
        serverKind: r.kind,
        models: r.models,
        version: r.version,
        lastSeenAt: new Date().toISOString(),
        apiKey: apiKey || undefined
      })
      if (!r.models.length) await invoke('ai.models.list', { providerId: p.id }).catch(() => [])
      const routes = await invoke('ai.suggestRoutes', { providerId: p.id })
      const cur = await invoke('ai.settings.get')
      const fill: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(routes)) if (!cur.routes[k as AiFeature]) fill[k] = v
      if (Object.keys(fill).length) await invoke('ai.settings.set', { routes: fill })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai.settings'] })
      onClose()
    }
  })
  const addManual = useMutation({
    mutationFn: async () => {
      const p = await invoke('ai.provider.upsert', { kind: 'openai-compat', label: `Server (${input})`, baseUrl: input, serverKind: 'openai-compat', apiKey: apiKey || undefined })
      await invoke('ai.models.list', { providerId: p.id })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ai.settings'] })
      onClose()
    }
  })

  return (
    <div className="space-y-3 rounded-md border border-accent/40 p-3">
      <div className="text-sm font-medium">Add a local model server</div>
      <p className="text-xs text-muted">Type a host, IP or URL — the port and server type are detected automatically (Ollama 11434, vLLM 8000, llama.cpp 8080, LM Studio 1234, …). Or scan this machine.</p>
      <div className="flex gap-2">
        <Input placeholder="localhost · 192.168.1.20 · http://gpu-box:8000" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan.mutate(input)} autoFocus />
        <Button onClick={() => scan.mutate(input)} loading={scan.isPending}>
          <Search className="size-3.5" /> Find
        </Button>
        <Button variant="primary" onClick={() => scan.mutate('')} loading={scan.isPending}>
          <Cpu className="size-3.5" /> Scan this machine
        </Button>
        <Button variant="ghost" onClick={onClose} aria-label="Cancel">
          <X className="size-4" />
        </Button>
      </div>
      <Input type="password" className="max-w-sm" placeholder="API key (only if the server needs one)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      {scan.isPending && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Probing ports…
        </div>
      )}
      {scan.error && <Alert kind="error">{scan.error.message}</Alert>}
      {results && results.length === 0 && (
        <Alert kind="warn">
          Nothing answered. Make sure the server is running (for Ollama: install from ollama.com and run <code>ollama serve</code>), then try again — or{' '}
          <button className="underline" onClick={() => setManual(true)}>
            enter the URL manually
          </button>
          .
        </Alert>
      )}
      {results?.map((r) => (
        <div key={r.baseUrl} className="flex items-start gap-3 rounded border border-border p-2 text-xs">
          <Cpu className="mt-0.5 size-4 text-accent" />
          <div className="flex-1">
            <div className="text-sm font-medium">
              {KIND_LABEL[r.kind] ?? r.kind} {r.version && <span className="text-muted">v{r.version}</span>}
            </div>
            <div className="text-muted">
              {r.baseUrl}
              {r.detail ? ` · ${r.detail}` : ''}
              {r.requiresApiKey && ' · requires an API key'}
            </div>
            <div className="mt-1 space-y-0.5">
              {r.models.slice(0, 12).map((m) => (
                <div key={m.id} className="flex items-center gap-2">
                  <span className="w-48 truncate">{m.id}</span>
                  <span className="w-24 text-muted">{[m.parameterSize, m.quantization].filter(Boolean).join(' ')}</span>
                  <CapBadges m={m} />
                </div>
              ))}
              {r.models.length > 12 && <div className="text-muted">+{r.models.length - 12} more</div>}
              {r.models.length === 0 && !r.requiresApiKey && <div className="text-muted">No models installed yet.</div>}
            </div>
          </div>
          <Button size="sm" variant="primary" onClick={() => add.mutate(r)} loading={add.isPending} disabled={r.requiresApiKey && !apiKey}>
            <Check className="size-3.5" /> Add
          </Button>
        </div>
      ))}
      {manual && (
        <div className="flex gap-2">
          <Input placeholder="http://host:port" value={input} onChange={(e) => setInput(e.target.value)} />
          <Button onClick={() => addManual.mutate()} loading={addManual.isPending} disabled={!input}>
            Add anyway
          </Button>
        </div>
      )}
      {addManual.error && <Alert kind="error">{addManual.error.message}</Alert>}
    </div>
  )
}

function ToolPermissions({ settings, onChange }: { settings: AiSettingsT; onChange: (list: string[]) => void }) {
  const tools = useQuery({ queryKey: ['ai.tools'], queryFn: () => invoke('ai.tools.list') })
  const risky = tools.data?.filter((t) => t.risk !== 'read') ?? []
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase text-muted">Tool permissions</h4>
      <p className="text-xs text-muted">Read-only tools always run. These change your mail; by default the assistant and MCP clients must ask first.</p>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {risky.map((t) => (
          <label key={t.name} className="flex items-center gap-2">
            <input type="checkbox" checked={settings.autoApproveTools.includes(t.name)} onChange={(e) => onChange(e.target.checked ? [...settings.autoApproveTools, t.name] : settings.autoApproveTools.filter((x) => x !== t.name))} />
            <code>{t.name}</code>
            <span className={cn('rounded px-1', t.risk === 'destructive' ? 'bg-danger/15 text-danger' : 'bg-hover text-muted')}>{t.risk}</span>
          </label>
        ))}
      </div>
    </section>
  )
}

function RunLog() {
  const runs = useQuery({ queryKey: ['ai.runs'], queryFn: () => invoke('ai.runs.list', { limit: 50 }), refetchInterval: 10_000 })
  if (!runs.data) return null
  const t = runs.data.totals
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase text-muted">Usage log</h4>
      <div className="text-xs text-muted">
        {t.runs} runs · {t.inputTokens.toLocaleString()} in / {t.outputTokens.toLocaleString()} out tokens · est. ${t.costUsd.toFixed(2)} on Claude (local models are free)
      </div>
      <div className="max-h-64 overflow-y-auto rounded border border-border text-xs">
        <table className="w-full">
          <tbody>
            {runs.data.runs.map((r) => (
              <tr key={r.id} className="border-b border-border">
                <td className="px-2 py-1 text-muted">{new Date(r.createdAt).toLocaleTimeString()}</td>
                <td className="px-2 py-1">{r.feature}</td>
                <td className="px-2 py-1 text-muted">{r.model}</td>
                <td className="px-2 py-1 text-muted">{r.inputTokens ?? '–'} / {r.outputTokens ?? '–'}</td>
                <td className="px-2 py-1 text-muted">{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : ''}</td>
                <td className={cn('px-2 py-1', !r.ok && 'text-danger')}>{r.ok ? 'ok' : (r.error ?? 'failed')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
