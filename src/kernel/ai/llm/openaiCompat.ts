/**
 * OpenAI-compatible chat provider for local servers: Ollama, vLLM, llama.cpp
 * (llama-server), LM Studio, LocalAI, LiteLLM, text-generation-webui, KoboldCpp…
 * Uses plain fetch so it works against anything that speaks /v1/chat/completions.
 */
import { z } from 'zod'
import { LLMError, type ChatMessage, type ChatRequest, type ChatResult, type ContentPart, type LLMProvider, type StreamDelta, type ToolDefinition } from './types'
import type { AiModelInfo, LocalServerKind, ModelCapabilities } from '@shared/schemas/ai'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:openai-compat')

export interface OpenAICompatOptions {
  id: string
  label: string
  baseUrl: string
  apiKey?: string
  headers?: Record<string, string>
  serverKind?: LocalServerKind | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

type OAIMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | OAIPart[] | null; tool_calls?: OAIToolCall[]; tool_call_id?: string; name?: string }
type OAIPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
type OAIToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

export class OpenAICompatProvider implements LLMProvider {
  readonly kind = 'openai-compat' as const
  readonly id: string
  readonly label: string
  readonly baseUrl: string
  readonly serverKind: LocalServerKind | null
  private readonly apiKey: string | undefined
  private readonly headers: Record<string, string>
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  /** Per-model memo of whether the server accepts `tools` / `response_format`. */
  private supports = new Map<string, { tools?: boolean; json?: boolean }>()

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.id
    this.label = opts.label
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.apiKey = opts.apiKey
    this.headers = opts.headers ?? {}
    this.serverKind = opts.serverKind ?? null
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /**
   * "Local" means the content stays on this machine or the LAN: loopback, link-local,
   * RFC 1918 ranges, Docker's host alias, single-label hostnames and `.local`/`.lan`/`.internal`
   * names. A public IP or a public domain is treated as cloud for the privacy policy.
   */
  get isLocal(): boolean {
    let host: string
    try {
      host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(this.baseUrl) ? this.baseUrl : `http://${this.baseUrl}`).hostname.toLowerCase()
    } catch {
      return false
    }
    host = host.replace(/^\[|\]$/g, '')
    if (host === 'localhost' || host === 'host.docker.internal' || host === '::1' || host === '0.0.0.0') return true
    if (/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(host)) return true
    if (/^(fe80:|fc|fd)/i.test(host)) return true
    if (!host.includes('.')) return true
    return /\.(local|lan|internal|home|localdomain)$/.test(host)
  }

  private async http<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; json: T | null; text: string }> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? this.timeoutMs)
    const outer = init.signal
    outer?.addEventListener('abort', () => ctrl.abort(), { once: true })
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...this.headers, ...(init.headers as Record<string, string>) }
      })
      const text = await res.text()
      let json: T | null = null
      try {
        json = text ? (JSON.parse(text) as T) : null
      } catch {
        json = null
      }
      return { status: res.status, json, text }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new LLMError(outer?.aborted ? 'Cancelled' : `Timed out talking to ${this.label}`, 'network', e)
      throw new LLMError(`Could not reach ${this.label} at ${this.baseUrl}`, 'network', e)
    } finally {
      clearTimeout(t)
    }
  }

  async chat(req: ChatRequest, onDelta?: (d: StreamDelta) => void): Promise<ChatResult> {
    const memo = this.supports.get(req.model) ?? {}
    const useTools = !!req.tools?.length && memo.tools !== false
    const useJsonSchema = !!req.outputSchema && memo.json !== false
    const messages: OAIMessage[] = []
    let system = req.system ?? ''
    if (req.outputSchema && !useJsonSchema) {
      system += `\n\nRespond ONLY with a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(z.toJSONSchema(req.outputSchema as never))}`
    }
    if (req.tools?.length && !useTools) {
      system += `\n\nYou cannot call tools on this server. If the task needs a tool, say which one and what input you would use.`
    }
    if (system) messages.push({ role: 'system', content: system })
    for (const m of req.messages) messages.push(...toOAIMessages(m))

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: !!onDelta,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.fast ? 0.2 : 0.3
    }
    if (useTools) body['tools'] = req.tools!.map(toOAITool)
    if (useJsonSchema) body['response_format'] = { type: 'json_schema', json_schema: { name: 'output', schema: z.toJSONSchema(req.outputSchema as never), strict: false } }
    if (this.serverKind === 'ollama') body['options'] = { num_ctx: 32768 }

    const attempt = async (): Promise<ChatResult> => {
      if (onDelta) return this.streamChat(body, req, onDelta)
      const r = await this.http<OAIResponse | { error?: { message?: string } | string }>('/v1/chat/completions', { method: 'POST', body: JSON.stringify(body), signal: req.signal })
      if (r.status === 401 || r.status === 403) throw new LLMError(`${this.label} requires an API key`, 'auth')
      if (r.status === 429) throw new LLMError(`${this.label} is busy (429)`, 'rate_limit')
      if (r.status >= 400 || !r.json) throw new LLMError(`${this.label} error ${r.status}: ${errorText(r.json, r.text)}`, r.status === 400 ? 'bad_request' : 'unknown')
      return fromOAIResponse(r.json as OAIResponse, req)
    }

    try {
      return await attempt()
    } catch (e) {
      // Degrade gracefully: servers that don't support tools / json_schema return 400.
      if (e instanceof LLMError && e.code === 'bad_request') {
        if (useTools && /tool|function/i.test(e.message)) {
          this.supports.set(req.model, { ...memo, tools: false })
          log.info('server rejected tools; retrying without', { model: req.model })
          return this.chat(req, onDelta)
        }
        if (useJsonSchema && /response_format|json_schema|schema/i.test(e.message)) {
          this.supports.set(req.model, { ...memo, json: false })
          log.info('server rejected json_schema; retrying with prompt-only JSON', { model: req.model })
          return this.chat(req, onDelta)
        }
      }
      throw e
    }
  }

  private async streamChat(body: Record<string, unknown>, req: ChatRequest, onDelta: (d: StreamDelta) => void): Promise<ChatResult> {
    const ctrl = new AbortController()
    req.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}), ...this.headers }
      })
    } catch (e) {
      clearTimeout(t)
      throw new LLMError(`Could not reach ${this.label} at ${this.baseUrl}`, 'network', e)
    }
    if (res.status === 401 || res.status === 403) throw new LLMError(`${this.label} requires an API key`, 'auth')
    if (res.status >= 400 || !res.body) {
      const text = await res.text().catch(() => '')
      clearTimeout(t)
      throw new LLMError(`${this.label} error ${res.status}: ${errorText(safeJson(text), text)}`, res.status === 400 ? 'bad_request' : 'unknown')
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let text = ''
    const toolAcc = new Map<number, { id: string; name: string; args: string }>()
    let usage = { inputTokens: 0, outputTokens: 0 }
    let finish: string | null = null
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim()
          buf = buf.slice(idx + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') continue
          let chunk: OAIStreamChunk
          try {
            chunk = JSON.parse(data) as OAIStreamChunk
          } catch {
            continue
          }
          if (chunk.usage) usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 }
          const choice = chunk.choices?.[0]
          if (!choice) continue
          if (choice.finish_reason) finish = choice.finish_reason
          const d = choice.delta
          if (d?.content) {
            text += d.content
            onDelta({ type: 'text', text: d.content })
          }
          if (d?.reasoning_content) onDelta({ type: 'thinking', text: d.reasoning_content })
          for (const tc of d?.tool_calls ?? []) {
            const slot = toolAcc.get(tc.index ?? 0) ?? { id: tc.id ?? `call_${tc.index ?? 0}`, name: '', args: '' }
            if (tc.id) slot.id = tc.id
            if (tc.function?.name) {
              slot.name += tc.function.name
              onDelta({ type: 'tool_start', name: slot.name })
            }
            if (tc.function?.arguments) slot.args += tc.function.arguments
            toolAcc.set(tc.index ?? 0, slot)
          }
        }
      }
    } finally {
      clearTimeout(t)
    }
    const toolCalls = [...toolAcc.values()].map((s) => ({ id: s.id, name: s.name, input: safeJson(s.args) ?? {} }))
    return finalize(text, toolCalls, finish, usage, req, body['model'] as string)
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const r = await this.http<{ data?: { embedding: number[]; index: number }[]; error?: unknown }>('/v1/embeddings', { method: 'POST', body: JSON.stringify({ model, input: texts }) })
    if (r.status >= 400 || !r.json?.data) throw new LLMError(`${this.label} embeddings error ${r.status}: ${errorText(r.json, r.text)}`, r.status === 400 ? 'unsupported' : 'unknown')
    return r.json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }

  async listModels(): Promise<AiModelInfo[]> {
    if (this.serverKind === 'ollama') {
      const r = await this.http<{ models?: OllamaTag[] }>('/api/tags', { timeoutMs: 8000 })
      if (r.status < 400 && r.json?.models) {
        const out: AiModelInfo[] = []
        for (const m of r.json.models) {
          const show = await this.http<OllamaShow>('/api/show', { method: 'POST', body: JSON.stringify({ model: m.name }), timeoutMs: 8000 }).catch(() => null)
          const caps = show?.json?.capabilities ?? []
          const ctxKey = show?.json?.model_info ? Object.keys(show.json.model_info).find((k) => k.endsWith('.context_length')) : undefined
          out.push({
            id: m.name,
            label: m.name,
            family: m.details?.family ?? show?.json?.details?.family ?? null,
            parameterSize: m.details?.parameter_size ?? null,
            quantization: m.details?.quantization_level ?? null,
            sizeBytes: m.size ?? null,
            capabilities: {
              tools: caps.length ? caps.includes('tools') : null,
              json: null,
              vision: caps.length ? caps.includes('vision') : null,
              embeddings: caps.length ? caps.includes('embedding') : /embed/i.test(m.name),
              contextTokens: ctxKey && show?.json?.model_info ? Number(show.json.model_info[ctxKey]) || null : null,
              tokensPerSecond: null,
              ttftMs: null,
              probedAt: null
            }
          })
        }
        return out
      }
    }
    const r = await this.http<{ data?: OAIModel[] }>('/v1/models', { timeoutMs: 8000 })
    if (r.status === 401 || r.status === 403) throw new LLMError(`${this.label} requires an API key`, 'auth')
    if (r.status >= 400 || !r.json?.data) throw new LLMError(`${this.label} /v1/models error ${r.status}`, 'unknown')
    let props: LlamaProps | null = null
    if (this.serverKind === 'llamacpp') props = (await this.http<LlamaProps>('/props', { timeoutMs: 4000 }).catch(() => null))?.json ?? null
    return r.json.data.map((m) => ({
      id: m.id,
      label: m.id,
      family: null,
      parameterSize: null,
      quantization: null,
      sizeBytes: null,
      capabilities: {
        tools: null,
        json: null,
        vision: null,
        embeddings: /embed/i.test(m.id) ? true : null,
        contextTokens: m.max_model_len ?? m.context_length ?? props?.default_generation_settings?.n_ctx ?? null,
        tokensPerSecond: null,
        ttftMs: null,
        probedAt: null
      }
    }))
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string; version?: string }> {
    try {
      if (this.serverKind === 'ollama') {
        const r = await this.http<{ version?: string }>('/api/version', { timeoutMs: 4000 })
        return r.status < 400 ? { ok: true, version: r.json?.version } : { ok: false, detail: `HTTP ${r.status}` }
      }
      const r = await this.http<unknown>('/v1/models', { timeoutMs: 4000 })
      if (r.status === 401 || r.status === 403) return { ok: false, detail: 'API key required or invalid' }
      return r.status < 400 ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Live capability probe: cheap, short requests. Each check is independent. */
  async probeModel(model: string): Promise<ModelCapabilities> {
    const caps: ModelCapabilities = { tools: null, json: null, vision: null, embeddings: null, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: new Date().toISOString() }
    const isEmbedding = /embed|bge|e5-|minilm|nomic/i.test(model)
    // embeddings
    try {
      const v = await this.embed(['hello'], model)
      caps.embeddings = Array.isArray(v[0]) && v[0]!.length > 0
    } catch {
      caps.embeddings = false
    }
    if (isEmbedding && caps.embeddings) {
      caps.tools = false
      caps.json = false
      caps.vision = false
      return caps
    }
    // speed + basic chat
    try {
      const started = Date.now()
      let first = 0
      const r = await this.chat({ model, messages: [{ role: 'user', content: 'Count from 1 to 30, separated by spaces.' }], maxTokens: 80, fast: true }, () => {
        if (!first) first = Date.now()
      })
      const ms = Date.now() - started
      caps.ttftMs = first ? first - started : null
      if (r.usage.outputTokens > 0 && ms > 0) caps.tokensPerSecond = Math.round((r.usage.outputTokens / (ms / 1000)) * 10) / 10
    } catch (e) {
      log.debug('speed probe failed', { model, error: String(e) })
    }
    // tools
    try {
      this.supports.delete(model)
      const r = await this.http<OAIResponse | { error?: unknown }>('/v1/chat/completions', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({
          model,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }],
          tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }]
        })
      })
      const calls = (r.json as OAIResponse)?.choices?.[0]?.message?.tool_calls
      caps.tools = r.status < 400 && Array.isArray(calls) && calls.length > 0
      if (r.status >= 400) this.supports.set(model, { tools: false })
    } catch {
      caps.tools = false
    }
    // json schema
    try {
      const r = await this.http<OAIResponse | { error?: unknown }>('/v1/chat/completions', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({
          model,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Return the capital of France.' }],
          response_format: { type: 'json_schema', json_schema: { name: 'o', schema: { type: 'object', properties: { capital: { type: 'string' } }, required: ['capital'] } } }
        })
      })
      const content = (r.json as OAIResponse)?.choices?.[0]?.message?.content
      caps.json = r.status < 400 && typeof content === 'string' && !!safeJson(content)
    } catch {
      caps.json = false
    }
    // vision (1x1 PNG)
    try {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
      const r = await this.http<OAIResponse | { error?: unknown }>('/v1/chat/completions', {
        method: 'POST',
        timeoutMs: 60_000,
        body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: [{ type: 'text', text: 'What color is this image? One word.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] }] })
      })
      caps.vision = r.status < 400 && typeof (r.json as OAIResponse)?.choices?.[0]?.message?.content === 'string'
    } catch {
      caps.vision = false
    }
    return caps
  }

  /** Ollama only: pull a model, reporting progress. */
  async pullModel(name: string, onProgress: (p: { status: string; completed?: number; total?: number }) => void, signal?: AbortSignal): Promise<void> {
    if (this.serverKind !== 'ollama') throw new LLMError('Model pulling is only supported for Ollama', 'unsupported')
    const res = await this.fetchImpl(`${this.baseUrl}/api/pull`, { method: 'POST', body: JSON.stringify({ model: name, stream: true }), signal, headers: { 'Content-Type': 'application/json', ...this.headers } })
    if (!res.ok || !res.body) throw new LLMError(`Ollama pull failed: HTTP ${res.status}`, 'unknown')
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        const j = safeJson(line) as { status?: string; completed?: number; total?: number; error?: string } | null
        if (j?.error) throw new LLMError(j.error, 'unknown')
        if (j?.status) onProgress({ status: j.status, completed: j.completed, total: j.total })
      }
    }
  }
}

// ---- helpers ---------------------------------------------------------------

export function normalizeBaseUrl(raw: string): string {
  let u = raw.trim()
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  u = u.replace(/\/+$/, '').replace(/\/(v1|api)$/i, '')
  return u
}

function toOAITool(t: ToolDefinition) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }
}

function toOAIMessages(m: ChatMessage): OAIMessage[] {
  if (typeof m.content === 'string') return [{ role: m.role, content: m.content }]
  const out: OAIMessage[] = []
  const parts: OAIPart[] = []
  const toolCalls: OAIToolCall[] = []
  for (const p of m.content) {
    if (p.type === 'text') parts.push({ type: 'text', text: p.text })
    else if (p.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.dataBase64}` } })
    else if (p.type === 'tool_use') toolCalls.push({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input ?? {}) } })
    else if (p.type === 'tool_result') out.push({ role: 'tool', tool_call_id: p.toolUseId, content: p.content })
  }
  if (m.role === 'assistant') {
    const textOnly = parts.length === 1 && parts[0]!.type === 'text' ? (parts[0] as { text: string }).text : parts.length ? parts : null
    if (textOnly !== null || toolCalls.length) out.unshift({ role: 'assistant', content: textOnly, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
  } else if (parts.length) {
    out.unshift({ role: 'user', content: parts.length === 1 && parts[0]!.type === 'text' ? (parts[0] as { text: string }).text : parts })
  }
  return out
}

interface OAIResponse {
  model?: string
  choices?: { message?: { content?: string | null; tool_calls?: OAIToolCall[]; reasoning_content?: string }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}
interface OAIStreamChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}
interface OAIModel {
  id: string
  max_model_len?: number
  context_length?: number
}
interface OllamaTag {
  name: string
  size?: number
  details?: { family?: string; parameter_size?: string; quantization_level?: string }
}
interface OllamaShow {
  capabilities?: string[]
  details?: { family?: string }
  model_info?: Record<string, unknown>
}
interface LlamaProps {
  default_generation_settings?: { n_ctx?: number }
}

function fromOAIResponse(r: OAIResponse, req: ChatRequest): ChatResult {
  const choice = r.choices?.[0]
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
  const toolCalls = (choice?.message?.tool_calls ?? []).map((tc) => ({ id: tc.id, name: tc.function.name, input: safeJson(tc.function.arguments) ?? {} }))
  return finalize(text, toolCalls, choice?.finish_reason ?? null, { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 }, req, r.model ?? req.model)
}

function finalize(text: string, toolCalls: ChatResult['toolCalls'], finish: string | null, usage: { inputTokens: number; outputTokens: number }, req: ChatRequest, model: string): ChatResult {
  let parsed: unknown
  if (req.outputSchema) {
    const j = extractJson(text)
    if (j !== null) {
      const p = req.outputSchema.safeParse(j)
      if (p.success) parsed = p.data
      else log.warn('structured output failed validation', { issues: p.error.issues.slice(0, 3) })
    }
  }
  const parts: ContentPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const tc of toolCalls) parts.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
  return {
    text,
    toolCalls,
    parsed,
    stopReason: toolCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end',
    usage,
    model,
    assistantMessage: { role: 'assistant', content: parts.length ? parts : text }
  }
}

function safeJson(s: string): unknown | null {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** Pull the first JSON object out of a response that may contain prose or ```json fences. */
export function extractJson(text: string): unknown | null {
  const direct = safeJson(text.trim())
  if (direct !== null) return direct
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    const j = safeJson(fence[1].trim())
    if (j !== null) return j
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return safeJson(text.slice(start, end + 1))
  return null
}

function errorText(json: unknown, text: string): string {
  const j = json as { error?: { message?: string } | string; message?: string } | null
  if (j?.error) return typeof j.error === 'string' ? j.error : (j.error.message ?? JSON.stringify(j.error))
  if (j?.message) return j.message
  return text.slice(0, 200)
}
