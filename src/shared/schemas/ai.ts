import { z } from 'zod'

export const AiProviderKindSchema = z.enum(['anthropic', 'openai-compat'])
export type AiProviderKind = z.output<typeof AiProviderKindSchema>

/** Fingerprinted flavour of an OpenAI-compatible local server. */
export const LocalServerKindSchema = z.enum(['ollama', 'vllm', 'llamacpp', 'lmstudio', 'tgi', 'localai', 'litellm', 'koboldcpp', 'textgen', 'openai-compat'])
export type LocalServerKind = z.output<typeof LocalServerKindSchema>

export const ModelCapabilitiesSchema = z.object({
  tools: z.boolean().nullable().default(null),
  json: z.boolean().nullable().default(null),
  vision: z.boolean().nullable().default(null),
  embeddings: z.boolean().nullable().default(null),
  contextTokens: z.number().nullable().default(null),
  /** Measured generation speed, tokens per second. */
  tokensPerSecond: z.number().nullable().default(null),
  /** Measured time to first token, ms. */
  ttftMs: z.number().nullable().default(null),
  probedAt: z.string().nullable().default(null)
})
export type ModelCapabilities = z.output<typeof ModelCapabilitiesSchema>

export const AiModelInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  family: z.string().nullable().default(null),
  parameterSize: z.string().nullable().default(null),
  quantization: z.string().nullable().default(null),
  sizeBytes: z.number().nullable().default(null),
  capabilities: ModelCapabilitiesSchema.prefault({})
})
export type AiModelInfo = z.output<typeof AiModelInfoSchema>

export const AiProviderConfigSchema = z.object({
  id: z.string(),
  kind: AiProviderKindSchema,
  label: z.string(),
  /** Base URL for OpenAI-compatible servers (no trailing /v1). Ignored for Anthropic. */
  baseUrl: z.string().default(''),
  serverKind: LocalServerKindSchema.nullable().default(null),
  /** Whether a key is stored in the vault for this provider. */
  hasApiKey: z.boolean().default(false),
  /** Extra headers for reverse proxies etc. */
  headers: z.record(z.string(), z.string()).prefault({}),
  timeoutMs: z.number().int().default(120_000),
  /** Cached model list (refreshed by discovery/listModels). */
  models: z.array(AiModelInfoSchema).default([]),
  enabled: z.boolean().default(true),
  lastSeenAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  version: z.string().nullable().default(null)
})
export type AiProviderConfig = z.output<typeof AiProviderConfigSchema>

export const AiFeatureSchema = z.enum(['chat', 'drafting', 'summarize', 'triage', 'extract', 'embeddings'])
export type AiFeature = z.output<typeof AiFeatureSchema>

export const AiRouteSchema = z.object({ providerId: z.string(), model: z.string() }).nullable()
export type AiRoute = z.output<typeof AiRouteSchema>

export const AiRoutesSchema = z.object({
  chat: AiRouteSchema.default(null),
  drafting: AiRouteSchema.default(null),
  summarize: AiRouteSchema.default(null),
  triage: AiRouteSchema.default(null),
  extract: AiRouteSchema.default(null),
  embeddings: AiRouteSchema.default(null)
})
export type AiRoutes = z.output<typeof AiRoutesSchema>

export const PrivacyModeSchema = z.enum(['local-only', 'cloud-allowed'])
export type PrivacyMode = z.output<typeof PrivacyModeSchema>

export const AiSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(AiProviderConfigSchema).default([]),
  routes: AiRoutesSchema.prefault({}),
  privacy: z
    .object({
      /** Local-only by default: nothing reaches a cloud API until the user opts in. */
      mode: PrivacyModeSchema.default('local-only'),
      perAccount: z.record(z.string(), PrivacyModeSchema).prefault({})
    })
    .prefault({}),
  /** Automatically triage new mail in the background. */
  autoTriage: z.boolean().default(true),
  /** Background embedding indexer. */
  autoIndex: z.boolean().default(true),
  indexWindowDays: z.number().int().default(365),
  /** Effort for Claude requests. */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  /** Tool names that the agent / MCP may run without confirmation. */
  autoApproveTools: z.array(z.string()).default([])
})
export type AiSettings = z.output<typeof AiSettingsSchema>
export type AiSettingsPatch = z.input<typeof AiSettingsSchema>

export const LocalServerProbeSchema = z.object({
  baseUrl: z.string(),
  kind: LocalServerKindSchema,
  version: z.string().nullable(),
  requiresApiKey: z.boolean(),
  models: z.array(AiModelInfoSchema),
  detail: z.string().optional()
})
export type LocalServerProbe = z.output<typeof LocalServerProbeSchema>

export const AiRunSchema = z.object({
  id: z.string(),
  feature: z.string(),
  providerId: z.string(),
  model: z.string(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.string().nullable(),
  durationMs: z.number().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
  createdAt: z.string()
})
export type AiRun = z.output<typeof AiRunSchema>

export const DEFAULT_ANTHROPIC_MODELS: AiModelInfo[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)', family: 'claude', parameterSize: null, quantization: null, sizeBytes: null, capabilities: { tools: true, json: true, vision: true, embeddings: false, contextTokens: 1_000_000, tokensPerSecond: null, ttftMs: null, probedAt: null } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', family: 'claude', parameterSize: null, quantization: null, sizeBytes: null, capabilities: { tools: true, json: true, vision: true, embeddings: false, contextTokens: 1_000_000, tokensPerSecond: null, ttftMs: null, probedAt: null } },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', family: 'claude', parameterSize: null, quantization: null, sizeBytes: null, capabilities: { tools: true, json: true, vision: true, embeddings: false, contextTokens: 1_000_000, tokensPerSecond: null, ttftMs: null, probedAt: null } }
]

/** Approximate list prices, USD per million tokens (input, output). Used only for the cost log. */
export const ANTHROPIC_PRICES: Record<string, [number, number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5]
}
