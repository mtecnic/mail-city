/**
 * Local LLM server discovery.
 *
 * Given anything the user types (`localhost`, `192.168.1.20`, `http://box:8000`,
 * `gpu:11434/v1`) — or nothing, for "scan this machine" — probe the common
 * ports, fingerprint the server kind and version, and list its models with
 * whatever metadata the server exposes.
 */
import type { AiModelInfo, LocalServerKind, LocalServerProbe } from '@shared/schemas/ai'
import { OpenAICompatProvider, normalizeBaseUrl } from './openaiCompat'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:discovery')

/** Ports in probe order with the server most commonly found there. */
export const KNOWN_PORTS: { port: number; hint: LocalServerKind }[] = [
  { port: 11434, hint: 'ollama' },
  { port: 8000, hint: 'vllm' },
  { port: 8080, hint: 'llamacpp' },
  { port: 1234, hint: 'lmstudio' },
  { port: 5000, hint: 'textgen' },
  { port: 5001, hint: 'koboldcpp' },
  { port: 4000, hint: 'litellm' },
  { port: 8001, hint: 'openai-compat' },
  { port: 3000, hint: 'openai-compat' },
  { port: 9000, hint: 'openai-compat' },
  { port: 8081, hint: 'localai' },
  { port: 3001, hint: 'openai-compat' }
]

export const LOCAL_HOSTS = ['localhost', '127.0.0.1', 'host.docker.internal']

export interface DiscoveryOptions {
  timeoutMs?: number
  fetchImpl?: typeof fetch
  apiKey?: string
  /** Probe these ports only (defaults to KNOWN_PORTS when the input has no port). */
  ports?: number[]
  signal?: AbortSignal
}

interface Fingerprint {
  kind: LocalServerKind
  version: string | null
  requiresApiKey: boolean
  detail?: string
}

async function get(fetchImpl: typeof fetch, url: string, timeoutMs: number, apiKey?: string, signal?: AbortSignal): Promise<{ status: number; json: unknown; text: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: res.status, json, text }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Identify what's listening at `baseUrl`. Returns null when nothing answers. */
export async function fingerprintServer(baseUrl: string, opts: DiscoveryOptions = {}): Promise<Fingerprint | null> {
  const f = opts.fetchImpl ?? fetch
  const t = opts.timeoutMs ?? 2500
  const key = opts.apiKey
  const g = (path: string) => get(f, `${baseUrl}${path}`, t, key, opts.signal)

  // Ollama: unique native endpoint.
  const ov = await g('/api/version')
  if (ov && ov.status === 200 && ov.json && typeof (ov.json as { version?: unknown }).version === 'string') {
    return { kind: 'ollama', version: (ov.json as { version: string }).version, requiresApiKey: false }
  }
  // llama.cpp llama-server
  const props = await g('/props')
  if (props && props.status === 200 && props.json && typeof props.json === 'object' && ('default_generation_settings' in (props.json as object) || 'model_path' in (props.json as object))) {
    const j = props.json as { build_info?: string; model_path?: string }
    return { kind: 'llamacpp', version: j.build_info ?? null, requiresApiKey: false, detail: j.model_path }
  }
  // KoboldCpp
  const kv = await g('/api/v1/info/version')
  if (kv && kv.status === 200 && kv.json && typeof (kv.json as { result?: unknown }).result === 'string') {
    return { kind: 'koboldcpp', version: (kv.json as { result: string }).result, requiresApiKey: false }
  }
  // Generic OpenAI-compatible listing.
  const models = await g('/v1/models')
  if (!models) return null
  if (models.status === 401 || models.status === 403) {
    // Something OpenAI-shaped that wants a key (vLLM --api-key, LiteLLM, LM Studio with auth…).
    const vv = await g('/version')
    const kind: LocalServerKind = vv?.status === 200 && (vv.json as { version?: string })?.version ? 'vllm' : 'openai-compat'
    return { kind, version: (vv?.json as { version?: string })?.version ?? null, requiresApiKey: true }
  }
  if (models.status !== 200) return null
  const data = (models.json as { data?: { id?: string; owned_by?: string; max_model_len?: number }[]; object?: string } | null)?.data
  if (!Array.isArray(data)) return null
  // vLLM
  const vv = await g('/version')
  if (vv && vv.status === 200 && (vv.json as { version?: string })?.version) return { kind: 'vllm', version: (vv.json as { version: string }).version, requiresApiKey: false }
  if (data.some((m) => typeof m.max_model_len === 'number')) return { kind: 'vllm', version: null, requiresApiKey: false }
  // TGI
  const info = await g('/info')
  if (info && info.status === 200 && (info.json as { model_id?: string })?.model_id) return { kind: 'tgi', version: (info.json as { version?: string })?.version ?? null, requiresApiKey: false }
  // LM Studio ids are usually "org/model" or owned_by "organization_owner"
  if (data.some((m) => m.owned_by === 'organization_owner' || /lmstudio|lm-studio/i.test(m.id ?? ''))) return { kind: 'lmstudio', version: null, requiresApiKey: false }
  // LiteLLM exposes /health/liveliness
  const lite = await g('/health/liveliness')
  if (lite && lite.status === 200) return { kind: 'litellm', version: null, requiresApiKey: false }
  // LocalAI exposes /readyz
  const localai = await g('/readyz')
  if (localai && localai.status === 200 && baseUrl.endsWith(':8080') === false) return { kind: 'localai', version: null, requiresApiKey: false }
  // text-generation-webui exposes /api/v1/model (legacy) alongside /v1
  const tg = await g('/api/v1/model')
  if (tg && tg.status === 200) return { kind: 'textgen', version: null, requiresApiKey: false }
  return { kind: 'openai-compat', version: null, requiresApiKey: false }
}

/** Expand user input into candidate base URLs. */
export function candidateUrls(input: string, ports: number[] = KNOWN_PORTS.map((p) => p.port)): string[] {
  const raw = input.trim()
  if (!raw) return LOCAL_HOSTS.slice(0, 2).flatMap((h) => ports.map((p) => `http://${h}:${p}`))
  let withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  withScheme = withScheme.replace(/\/+$/, '').replace(/\/(v1|api)$/i, '')
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return []
  }
  const hasExplicitPort = /:\d+(\/|$)/.test(raw.replace(/^https?:\/\//i, ''))
  if (hasExplicitPort || (u.protocol === 'https:' && !u.port)) {
    const base = `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`
    // Try https too when the user typed http against a public-looking FQDN (reverse proxies).
    const fqdn = /\.[a-z]{2,}$/i.test(u.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)
    return u.protocol === 'http:' && fqdn ? [base, base.replace(/^http:/, 'https:')] : [base]
  }
  return ports.map((p) => `http://${u.hostname}:${p}${u.pathname.replace(/\/$/, '')}`)
}

/** Probe one or more candidate URLs in parallel and return every server that answered, with its models. */
export async function discoverLocalServers(input: string, opts: DiscoveryOptions = {}): Promise<LocalServerProbe[]> {
  const urls = candidateUrls(input, opts.ports)
  log.info('probing', { count: urls.length, input })
  const results = await Promise.all(
    urls.map(async (baseUrl): Promise<LocalServerProbe | null> => {
      const fp = await fingerprintServer(baseUrl, opts)
      if (!fp) return null
      let models: AiModelInfo[] = []
      if (!fp.requiresApiKey || opts.apiKey) {
        try {
          const p = new OpenAICompatProvider({ id: 'probe', label: baseUrl, baseUrl, serverKind: fp.kind, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl, timeoutMs: 10_000 })
          models = await p.listModels()
        } catch (e) {
          log.debug('model listing failed', { baseUrl, error: String(e) })
        }
      }
      return { baseUrl: normalizeBaseUrl(baseUrl), kind: fp.kind, version: fp.version, requiresApiKey: fp.requiresApiKey, models, detail: fp.detail }
    })
  )
  // Dedupe (localhost vs 127.0.0.1 answering the same server).
  const seen = new Set<string>()
  return results.filter((r): r is LocalServerProbe => {
    if (!r) return false
    const key = `${r.kind}:${r.version}:${r.models.map((m) => m.id).join(',')}:${new URL(r.baseUrl).port}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Sensible role assignment from a model list: biggest tools-capable → chat/drafting, smallest → triage, embedding model → embeddings. */
export function suggestRoles(models: AiModelInfo[]): { chat?: string; drafting?: string; triage?: string; summarize?: string; extract?: string; embeddings?: string } {
  const size = (m: AiModelInfo) => {
    const p = m.parameterSize?.match(/([\d.]+)\s*([bBmM])/)
    if (p) return Number(p[1]) * (p[2]!.toLowerCase() === 'b' ? 1e9 : 1e6)
    return m.sizeBytes ?? 0
  }
  const embed = models.filter((m) => m.capabilities.embeddings === true || /embed|bge|e5-|minilm|nomic/i.test(m.id))
  const chatModels = models.filter((m) => !embed.includes(m)).sort((a, b) => size(b) - size(a))
  const toolsCapable = chatModels.filter((m) => m.capabilities.tools !== false)
  const big = toolsCapable[0] ?? chatModels[0]
  const small = [...chatModels].reverse().find((m) => m.capabilities.tools !== false) ?? chatModels[chatModels.length - 1]
  return {
    chat: big?.id,
    drafting: big?.id,
    summarize: small?.id ?? big?.id,
    triage: small?.id ?? big?.id,
    extract: toolsCapable.find((m) => m.capabilities.json !== false)?.id ?? big?.id,
    embeddings: embed[0]?.id
  }
}

export const RECOMMENDED_OLLAMA_MODELS = [
  { name: 'llama3.2:3b', purpose: 'Fast triage & summaries (tools-capable, ~2 GB)' },
  { name: 'qwen2.5:7b', purpose: 'Drafting & chat with tool calling (~4.7 GB)' },
  { name: 'nomic-embed-text', purpose: 'Embeddings for semantic search (~270 MB)' }
]
