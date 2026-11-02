/**
 * Provider-agnostic chat interface. Every LLM backend (Claude, Ollama, vLLM,
 * llama.cpp, LM Studio, …) is normalized to this shape so features and the
 * agent loop are written once.
 */
import type { z } from 'zod'
import type { AiModelInfo, ModelCapabilities } from '@shared/schemas/ai'

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema (draft 2020-12 subset) for the input object. */
  inputSchema: Record<string, unknown>
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; dataBase64: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface ChatRequest {
  model: string
  system?: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  /** Ask for a JSON object matching this zod schema (structured output). */
  outputSchema?: z.ZodType
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Latency-sensitive request (chat); providers may trade depth for speed. */
  fast?: boolean
  signal?: AbortSignal
  /** Stable prefix hint for prompt caching (Anthropic). */
  cache?: boolean
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface ChatResult {
  text: string
  toolCalls: ToolCall[]
  /** Parsed structured output when `outputSchema` was given. */
  parsed?: unknown
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'error'
  refusal?: { category: string | null; explanation: string | null }
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  model: string
  /** Raw assistant content to echo back on the next turn (provider-specific). */
  assistantMessage: ChatMessage
}

export type StreamDelta = { type: 'text'; text: string } | { type: 'tool_start'; name: string } | { type: 'thinking'; text: string }

export interface LLMProvider {
  readonly id: string
  readonly kind: 'anthropic' | 'openai-compat'
  readonly label: string
  readonly isLocal: boolean
  chat(req: ChatRequest, onDelta?: (d: StreamDelta) => void): Promise<ChatResult>
  embed?(texts: string[], model: string): Promise<number[][]>
  listModels(): Promise<AiModelInfo[]>
  healthcheck(): Promise<{ ok: boolean; detail?: string; version?: string }>
  /** Live-probe what a model can do (tools / JSON / vision / embeddings / speed). */
  probeModel?(model: string): Promise<ModelCapabilities>
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly code: 'auth' | 'network' | 'rate_limit' | 'bad_request' | 'unsupported' | 'refusal' | 'unknown',
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

export function textOf(c: string | ContentPart[]): string {
  return typeof c === 'string' ? c : c.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map((p) => p.text).join('')
}
