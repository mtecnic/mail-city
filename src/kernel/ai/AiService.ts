/**
 * AI facade: settings, provider registry, privacy policy, routing per feature,
 * run logging, and local server discovery.
 */
import { desc } from 'drizzle-orm'
import type { DB } from '../db'
import { aiRuns } from '../db/schema'
import type { SettingsStore } from '../settings/SettingsStore'
import type { SecretVault } from '../utils/vault'
import { AiSettingsSchema, AiProviderConfigSchema, ANTHROPIC_PRICES, DEFAULT_ANTHROPIC_MODELS, type AiFeature, type AiModelInfo, type AiProviderConfig, type AiRun, type AiSettings, type AiSettingsPatch, type LocalServerProbe, type ModelCapabilities } from '@shared/schemas/ai'
import { AnthropicProvider } from './llm/anthropic'
import { OpenAICompatProvider } from './llm/openaiCompat'
import { discoverLocalServers, suggestRoles } from './llm/discovery'
import { LLMError, type ChatRequest, type ChatResult, type LLMProvider, type StreamDelta } from './llm/types'
import { TypedEmitter } from '../utils/emitter'
import { createLogger } from '../utils/logger'
import { newId } from '../utils/ids'

const KEY = 'ai'
const log = createLogger('ai')

export class AiService extends TypedEmitter<{ changed: [AiSettings]; pullProgress: [{ providerId: string; model: string; status: string; completed?: number; total?: number; done?: boolean; error?: string }] }> {
  private providers = new Map<string, LLMProvider>()

  constructor(
    private readonly db: DB,
    private readonly settings: SettingsStore,
    private readonly vault: SecretVault
  ) {
    super()
  }

  // ---- settings -------------------------------------------------------------

  get(): AiSettings {
    const s = this.settings.getValue(KEY, AiSettingsSchema)
    // Reflect vault state.
    s.providers = s.providers.map((p) => ({ ...p, hasApiKey: this.vault.has(`ai.${p.id}`) }))
    return s
  }

  set(patch: AiSettingsPatch): AiSettings {
    const cur = this.get()
    const next = AiSettingsSchema.parse({ ...cur, ...patch, privacy: { ...cur.privacy, ...(patch.privacy ?? {}) }, routes: { ...cur.routes, ...(patch.routes ?? {}) } })
    this.settings.setValue(KEY, next)
    this.providers.clear()
    this.emit('changed', next)
    return next
  }

  upsertProvider(cfg: Partial<AiProviderConfig> & { id?: string; kind: AiProviderConfig['kind'] }): AiProviderConfig {
    const cur = this.get()
    const id = cfg.id ?? newId('prov')
    const existing = cur.providers.find((p) => p.id === id)
    const merged = AiProviderConfigSchema.parse({ ...(existing ?? {}), ...cfg, id })
    const providers = existing ? cur.providers.map((p) => (p.id === id ? merged : p)) : [...cur.providers, merged]
    this.set({ providers })
    return merged
  }

  removeProvider(id: string): void {
    const cur = this.get()
    this.vault.delete(`ai.${id}`)
    const routes = { ...cur.routes }
    for (const k of Object.keys(routes) as AiFeature[]) if (routes[k]?.providerId === id) routes[k] = null
    this.set({ providers: cur.providers.filter((p) => p.id !== id), routes })
  }

  setApiKey(providerId: string, apiKey: string | null): void {
    if (apiKey) this.vault.set(`ai.${providerId}`, apiKey)
    else this.vault.delete(`ai.${providerId}`)
    this.providers.delete(providerId)
    this.emit('changed', this.get())
  }

  // ---- providers --------------------------------------------------------------

  provider(id: string): LLMProvider {
    const cached = this.providers.get(id)
    if (cached) return cached
    const cfg = this.get().providers.find((p) => p.id === id)
    if (!cfg) throw new LLMError(`AI provider ${id} is not configured`, 'unsupported')
    const key = this.vault.get(`ai.${id}`) ?? undefined
    const p: LLMProvider =
      cfg.kind === 'anthropic'
        ? new AnthropicProvider(cfg.id, cfg.label, key ?? '', this.get().effort)
        : new OpenAICompatProvider({ id: cfg.id, label: cfg.label, baseUrl: cfg.baseUrl, apiKey: key, headers: cfg.headers, serverKind: cfg.serverKind, timeoutMs: cfg.timeoutMs })
    this.providers.set(id, p)
    return p
  }

  isLocalProvider(id: string): boolean {
    try {
      return this.provider(id).isLocal
    } catch {
      return false
    }
  }

  /** Is cloud AI allowed for these accounts under the privacy policy? */
  cloudAllowed(accountIds: string[] = []): boolean {
    const s = this.get()
    if (s.privacy.mode === 'local-only') return false
    return accountIds.every((a) => (s.privacy.perAccount[a] ?? 'cloud-allowed') === 'cloud-allowed')
  }

  /**
   * Resolve the provider+model for a feature, honoring privacy. Falls back to any
   * configured local provider if the routed one is cloud and cloud isn't allowed.
   */
  routeFor(feature: AiFeature, accountIds: string[] = []): { provider: LLMProvider; model: string } | null {
    const s = this.get()
    if (!s.enabled) return null
    const allowCloud = this.cloudAllowed(accountIds)
    const tryRoute = (r: { providerId: string; model: string } | null) => {
      if (!r) return null
      const cfg = s.providers.find((p) => p.id === r.providerId && p.enabled)
      if (!cfg) return null
      const provider = this.provider(r.providerId)
      if (!provider.isLocal && !allowCloud) return null
      return { provider, model: r.model }
    }
    const primary = tryRoute(s.routes[feature]) ?? tryRoute(s.routes.chat)
    if (primary) return primary
    // Fallback: first enabled provider that is allowed, with a sensible model.
    for (const cfg of s.providers.filter((p) => p.enabled)) {
      const provider = this.provider(cfg.id)
      if (!provider.isLocal && !allowCloud) continue
      const models = cfg.kind === 'anthropic' ? DEFAULT_ANTHROPIC_MODELS : cfg.models
      const roles = suggestRoles(models)
      const model = feature === 'embeddings' ? roles.embeddings : (roles[feature] ?? roles.chat)
      if (model) return { provider, model }
    }
    return null
  }

  /** Chat through a feature route with run logging. */
  async chat(feature: AiFeature, req: Omit<ChatRequest, 'model'> & { model?: string; accountIds?: string[]; messageIds?: string[] }, onDelta?: (d: StreamDelta) => void): Promise<ChatResult> {
    const route = this.routeFor(feature, req.accountIds)
    if (!route) throw new LLMError(this.get().enabled ? 'No AI model is available for this feature under the current privacy settings. Configure one in Settings → AI.' : 'AI features are disabled in Settings → AI.', 'unsupported')
    const started = Date.now()
    const model = req.model ?? route.model
    try {
      const r = await route.provider.chat({ ...req, model, effort: req.effort ?? this.get().effort }, onDelta)
      this.logRun({ feature, providerId: route.provider.id, model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, durationMs: Date.now() - started, messageIds: req.messageIds ?? [], ok: r.stopReason !== 'refusal', error: r.stopReason === 'refusal' ? `refusal:${r.refusal?.category ?? ''}` : null })
      return r
    } catch (e) {
      this.logRun({ feature, providerId: route.provider.id, model, durationMs: Date.now() - started, messageIds: req.messageIds ?? [], ok: false, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  async embed(texts: string[], accountIds: string[] = []): Promise<{ vectors: number[][]; model: string; providerId: string } | null> {
    const route = this.routeFor('embeddings', accountIds)
    if (!route?.provider.embed) return null
    const vectors = await route.provider.embed(texts, route.model)
    return { vectors, model: route.model, providerId: route.provider.id }
  }

  // ---- discovery ----------------------------------------------------------------

  discoverLocal(input: string, apiKey?: string): Promise<LocalServerProbe[]> {
    return discoverLocalServers(input, { apiKey })
  }

  async listModels(providerId: string): Promise<AiModelInfo[]> {
    const p = this.provider(providerId)
    const models = await p.listModels()
    const cur = this.get().providers.find((x) => x.id === providerId)
    // Keep previously probed capabilities.
    const merged = models.map((m) => {
      const prev = cur?.models.find((x) => x.id === m.id)
      return prev?.capabilities.probedAt ? { ...m, capabilities: { ...m.capabilities, ...prev.capabilities } } : m
    })
    this.upsertProvider({ id: providerId, kind: cur?.kind ?? 'openai-compat', models: merged, lastSeenAt: new Date().toISOString(), lastError: null })
    return merged
  }

  async probeModel(providerId: string, model: string): Promise<ModelCapabilities> {
    const p = this.provider(providerId)
    if (!p.probeModel) {
      const m = DEFAULT_ANTHROPIC_MODELS[0]!.capabilities
      return { ...m, probedAt: new Date().toISOString() }
    }
    const caps = await p.probeModel(model)
    const cur = this.get().providers.find((x) => x.id === providerId)
    if (cur) {
      const models = cur.models.some((m) => m.id === model) ? cur.models.map((m) => (m.id === model ? { ...m, capabilities: { ...m.capabilities, ...caps } } : m)) : [...cur.models, { id: model, label: model, family: null, parameterSize: null, quantization: null, sizeBytes: null, capabilities: caps }]
      this.upsertProvider({ id: providerId, kind: cur.kind, models })
    }
    return caps
  }

  async healthcheck(providerId: string): Promise<{ ok: boolean; detail?: string; version?: string }> {
    try {
      const r = await this.provider(providerId).healthcheck()
      const cur = this.get().providers.find((x) => x.id === providerId)
      if (cur) this.upsertProvider({ id: providerId, kind: cur.kind, lastSeenAt: r.ok ? new Date().toISOString() : cur.lastSeenAt, lastError: r.ok ? null : (r.detail ?? 'unreachable'), version: r.version ?? cur.version })
      return r
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }

  async pullModel(providerId: string, model: string): Promise<void> {
    const p = this.provider(providerId)
    if (!(p instanceof OpenAICompatProvider)) throw new LLMError('Not an Ollama provider', 'unsupported')
    try {
      await p.pullModel(model, (prog) => this.emit('pullProgress', { providerId, model, ...prog }))
      this.emit('pullProgress', { providerId, model, status: 'done', done: true })
      await this.listModels(providerId)
    } catch (e) {
      this.emit('pullProgress', { providerId, model, status: 'error', done: true, error: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  suggestRoutes(providerId: string): Partial<Record<AiFeature, { providerId: string; model: string }>> {
    const cfg = this.get().providers.find((p) => p.id === providerId)
    if (!cfg) return {}
    const roles = suggestRoles(cfg.kind === 'anthropic' ? DEFAULT_ANTHROPIC_MODELS : cfg.models)
    const out: Partial<Record<AiFeature, { providerId: string; model: string }>> = {}
    for (const [k, v] of Object.entries(roles) as [AiFeature, string | undefined][]) if (v) out[k] = { providerId, model: v }
    return out
  }

  // ---- run log -------------------------------------------------------------------

  logRun(r: { feature: string; providerId: string; model: string; inputTokens?: number; outputTokens?: number; durationMs: number; messageIds: string[]; ok: boolean; error: string | null }): void {
    const price = ANTHROPIC_PRICES[r.model]
    const cost = price && r.inputTokens !== undefined ? ((r.inputTokens ?? 0) * price[0] + (r.outputTokens ?? 0) * price[1]) / 1e6 : null
    this.db
      .insert(aiRuns)
      .values({ id: newId('run'), feature: r.feature, providerId: r.providerId, model: r.model, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null, costUsd: cost !== null ? cost.toFixed(6) : null, durationMs: r.durationMs, messageIds: r.messageIds, ok: r.ok, error: r.error, createdAt: new Date().toISOString() })
      .run()
    if (!r.ok) log.debug('ai run failed', { feature: r.feature, error: r.error })
  }

  runs(limit = 100): AiRun[] {
    return this.db
      .select()
      .from(aiRuns)
      .orderBy(desc(aiRuns.createdAt))
      .limit(limit)
      .all()
      .map((r) => ({ id: r.id, feature: r.feature, providerId: r.providerId, model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, durationMs: r.durationMs, ok: r.ok, error: r.error, createdAt: r.createdAt }))
  }

  runTotals(): { runs: number; costUsd: number; inputTokens: number; outputTokens: number } {
    const rows = this.db.select().from(aiRuns).all()
    return {
      runs: rows.length,
      costUsd: rows.reduce((n, r) => n + Number(r.costUsd ?? 0), 0),
      inputTokens: rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
      outputTokens: rows.reduce((n, r) => n + (r.outputTokens ?? 0), 0)
    }
  }
}
