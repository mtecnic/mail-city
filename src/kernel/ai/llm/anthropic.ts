import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { BetaMessageParam, BetaContentBlockParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { LLMError, type ChatMessage, type ChatRequest, type ChatResult, type ContentPart, type LLMProvider, type StreamDelta, type ToolDefinition } from './types'
import { DEFAULT_ANTHROPIC_MODELS, type AiModelInfo } from '@shared/schemas/ai'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:anthropic')
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export class AnthropicProvider implements LLMProvider {
  readonly kind = 'anthropic' as const
  readonly isLocal = false
  private client: Anthropic

  constructor(
    readonly id: string,
    readonly label: string,
    apiKey: string,
    private readonly defaultEffort: ChatRequest['effort'] = 'medium'
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 10 * 60_000 })
  }

  async chat(req: ChatRequest, onDelta?: (d: StreamDelta) => void): Promise<ChatResult> {
    const tools: BetaTool[] | undefined = req.tools?.map((t) => toBetaTool(t, !!onDelta))
    const system = req.system ? [{ type: 'text' as const, text: req.system, ...(req.cache !== false ? { cache_control: { type: 'ephemeral' as const } } : {}) }] : undefined
    const base = {
      model: req.model,
      max_tokens: req.maxTokens ?? (onDelta ? 32_000 : 16_000),
      system,
      messages: req.messages.map(toBetaMessage),
      tools,
      betas: [FALLBACK_BETA],
      fallbacks: 'default' as const,
      output_config: {
        effort: req.fast ? 'low' : (req.effort ?? this.defaultEffort),
        ...(req.outputSchema ? { format: zodOutputFormat(req.outputSchema as never) } : {})
      }
    }
    try {
      let msg
      if (onDelta) {
        const stream = this.client.beta.messages.stream({ ...base, thinking: { type: 'adaptive', display: 'updates' }, betas: [FALLBACK_BETA, 'thinking-display-updates-2026-08-18'] }, { signal: req.signal })
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'text_delta') onDelta({ type: 'text', text: ev.delta.text })
            else if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) onDelta({ type: 'thinking', text: ev.delta.thinking })
          } else if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
            onDelta({ type: 'tool_start', name: ev.content_block.name })
          }
        }
        msg = await stream.finalMessage()
      } else {
        msg = await this.client.beta.messages.create(base, { signal: req.signal })
      }
      return fromBetaMessage(msg, req)
    } catch (e) {
      throw mapError(e)
    }
  }

  async listModels(): Promise<AiModelInfo[]> {
    try {
      const page = await this.client.models.list({ limit: 100 })
      const ids = new Set<string>()
      const out: AiModelInfo[] = []
      for await (const m of page) {
        ids.add(m.id)
        out.push({
          id: m.id,
          label: m.display_name,
          family: 'claude',
          parameterSize: null,
          quantization: null,
          sizeBytes: null,
          capabilities: { tools: true, json: true, vision: true, embeddings: false, contextTokens: (m as { max_input_tokens?: number }).max_input_tokens ?? null, tokensPerSecond: null, ttftMs: null, probedAt: null }
        })
      }
      // Put our known-good defaults first.
      return [...DEFAULT_ANTHROPIC_MODELS.filter((d) => ids.has(d.id)), ...out.filter((m) => !DEFAULT_ANTHROPIC_MODELS.some((d) => d.id === m.id))]
    } catch (e) {
      log.warn('models.list failed; using defaults', { error: String(e) })
      return DEFAULT_ANTHROPIC_MODELS
    }
  }

  async healthcheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client.models.retrieve('claude-opus-5-5')
      return { ok: true }
    } catch (e) {
      const err = mapError(e)
      return { ok: false, detail: err.message }
    }
  }
}

function toBetaTool(t: ToolDefinition, streaming: boolean): BetaTool {
  // Strict mode needs every property listed in `required`; tools with optional inputs run non-strict.
  const props = Object.keys((t.inputSchema['properties'] as Record<string, unknown> | undefined) ?? {})
  const required = (t.inputSchema['required'] as string[] | undefined) ?? []
  const strict = props.length === required.length && t.inputSchema['additionalProperties'] === false
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as BetaTool['input_schema'],
    ...(strict ? { strict: true } : {}),
    ...(streaming ? { eager_input_streaming: true } : {})
  }
}

function toBetaMessage(m: ChatMessage): BetaMessageParam {
  if (typeof m.content === 'string') return { role: m.role, content: m.content }
  const parts: BetaContentBlockParam[] = m.content.map((p): BetaContentBlockParam => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text }
      case 'image':
        return { type: 'image', source: { type: 'base64', media_type: p.mimeType as 'image/png', data: p.dataBase64 } }
      case 'tool_use':
        return { type: 'tool_use', id: p.id, name: p.name, input: p.input }
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: p.toolUseId, content: p.content, is_error: p.isError }
    }
  })
  return { role: m.role, content: parts }
}

function fromBetaMessage(msg: Anthropic.Beta.Messages.BetaMessage, req: ChatRequest): ChatResult {
  const parts: ContentPart[] = []
  let text = ''
  const toolCalls: ChatResult['toolCalls'] = []
  for (const b of msg.content) {
    if (b.type === 'text') {
      text += b.text
      parts.push({ type: 'text', text: b.text })
    } else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id, name: b.name, input: b.input })
      parts.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
    }
  }
  let parsed: unknown
  if (req.outputSchema && text) {
    try {
      parsed = req.outputSchema.parse(JSON.parse(text))
    } catch (e) {
      log.warn('structured output failed to parse', { error: String(e) })
    }
  }
  const stop: ChatResult['stopReason'] =
    msg.stop_reason === 'tool_use' ? 'tool_use' : msg.stop_reason === 'max_tokens' ? 'max_tokens' : msg.stop_reason === 'refusal' ? 'refusal' : 'end'
  const usage = msg.usage as { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null }
  return {
    text,
    toolCalls,
    parsed,
    stopReason: stop,
    refusal: msg.stop_reason === 'refusal' ? { category: (msg.stop_details as { category?: string | null } | null)?.category ?? null, explanation: (msg.stop_details as { explanation?: string | null } | null)?.explanation ?? null } : undefined,
    usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? undefined },
    model: msg.model,
    assistantMessage: { role: 'assistant', content: parts.length ? parts : text }
  }
}

function mapError(e: unknown): LLMError {
  if (e instanceof LLMError) return e
  if (e instanceof Anthropic.AuthenticationError) return new LLMError('Anthropic rejected the API key', 'auth', e)
  if (e instanceof Anthropic.RateLimitError) return new LLMError('Anthropic rate limit reached; try again shortly', 'rate_limit', e)
  if (e instanceof Anthropic.BadRequestError) return new LLMError(`Anthropic rejected the request: ${e.message}`, 'bad_request', e)
  if (e instanceof Anthropic.APIConnectionError) return new LLMError('Could not reach the Anthropic API', 'network', e)
  if (e instanceof Anthropic.APIError) return new LLMError(`Anthropic API error ${e.status}: ${e.message}`, 'unknown', e)
  return new LLMError(e instanceof Error ? e.message : String(e), 'unknown', e)
}
