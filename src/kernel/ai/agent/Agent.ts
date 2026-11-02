/**
 * Multi-step assistant: a provider-agnostic tool loop over the shared tool
 * registry with streaming, confirmation gates and persisted transcripts.
 */
import { desc, eq } from 'drizzle-orm'
import type { DB } from '../../db'
import { aiSessions } from '../../db/schema'
import type { AiService } from '../AiService'
import type { ToolRegistry, ToolSpec } from '../tools/registry'
import type { ChatMessage, ContentPart, StreamDelta } from '../llm/types'
import { AGENT_SYSTEM } from '../prompts'
import { TypedEmitter } from '../../utils/emitter'
import { newId } from '../../utils/ids'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:agent')
const MAX_ITERATIONS = 12
const MAX_HISTORY_MESSAGES = 40

/** What the UI renders: a flat list of events per session. */
export type TranscriptEvent =
  | { type: 'user'; text: string; at: string }
  | { type: 'assistant'; text: string; at: string }
  | { type: 'thinking'; text: string; at: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown; summary: string; at: string }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; text: string; declined?: boolean; at: string }
  | { type: 'error'; text: string; at: string }

export interface AgentSession {
  id: string
  title: string
  transcript: TranscriptEvent[]
  /** Provider-level message history (echoed back each turn). */
  history: ChatMessage[]
  context: { accountId?: string; messageId?: string; threadId?: string }
  createdAt: string
  updatedAt: string
}

export type AgentEvents = {
  event: [sessionId: string, ev: TranscriptEvent]
  delta: [sessionId: string, d: StreamDelta]
  done: [sessionId: string]
  /** Ask the UI to confirm a risky tool; resolve via `resolveConfirmation`. */
  confirm: [sessionId: string, req: { id: string; tool: string; risk: string; summary: string; input: unknown }]
}

export class Agent extends TypedEmitter<AgentEvents> {
  private sessions = new Map<string, AgentSession>()
  private pending = new Map<string, (ok: boolean) => void>()
  private aborts = new Map<string, AbortController>()

  constructor(
    private readonly db: DB,
    private readonly ai: AiService,
    private readonly tools: ToolRegistry,
    private readonly contextBuilder: (ctx: AgentSession['context']) => string
  ) {
    super()
  }

  // ---- sessions ---------------------------------------------------------------

  list(): { id: string; title: string; updatedAt: string }[] {
    return this.db
      .select({ id: aiSessions.id, title: aiSessions.title, updatedAt: aiSessions.updatedAt })
      .from(aiSessions)
      .orderBy(desc(aiSessions.updatedAt))
      .limit(50)
      .all()
  }

  get(id: string): AgentSession | undefined {
    const cached = this.sessions.get(id)
    if (cached) return cached
    const row = this.db.select().from(aiSessions).where(eq(aiSessions.id, id)).get()
    if (!row) return undefined
    const ctx = row.context as { history?: ChatMessage[]; accountId?: string; messageId?: string; threadId?: string }
    const s: AgentSession = { id: row.id, title: row.title, transcript: row.transcript as TranscriptEvent[], history: ctx.history ?? [], context: { accountId: ctx.accountId, messageId: ctx.messageId, threadId: ctx.threadId }, createdAt: row.createdAt, updatedAt: row.updatedAt }
    this.sessions.set(id, s)
    return s
  }

  create(context: AgentSession['context'] = {}): AgentSession {
    const now = new Date().toISOString()
    const s: AgentSession = { id: newId('ses'), title: 'New conversation', transcript: [], history: [], context, createdAt: now, updatedAt: now }
    this.sessions.set(s.id, s)
    this.persist(s)
    return s
  }

  remove(id: string): void {
    this.cancel(id)
    this.sessions.delete(id)
    this.db.delete(aiSessions).where(eq(aiSessions.id, id)).run()
  }

  private persist(s: AgentSession) {
    s.updatedAt = new Date().toISOString()
    const values = { id: s.id, title: s.title, transcript: s.transcript.slice(-200), context: { ...s.context, history: s.history.slice(-MAX_HISTORY_MESSAGES) }, createdAt: s.createdAt, updatedAt: s.updatedAt }
    this.db
      .insert(aiSessions)
      .values(values)
      .onConflictDoUpdate({ target: aiSessions.id, set: { title: values.title, transcript: values.transcript, context: values.context, updatedAt: values.updatedAt } })
      .run()
  }

  private push(s: AgentSession, ev: TranscriptEvent) {
    s.transcript.push(ev)
    this.emit('event', s.id, ev)
  }

  resolveConfirmation(id: string, ok: boolean): void {
    this.pending.get(id)?.(ok)
    this.pending.delete(id)
  }

  cancel(sessionId: string): void {
    this.aborts.get(sessionId)?.abort()
    for (const [id, resolve] of this.pending) {
      if (id.startsWith(sessionId)) {
        resolve(false)
        this.pending.delete(id)
      }
    }
  }

  // ---- the loop -------------------------------------------------------------------

  async send(sessionId: string, text: string): Promise<void> {
    const s = this.get(sessionId)
    if (!s) throw new Error('Session not found')
    if (this.aborts.has(sessionId)) throw new Error('The assistant is still working on the previous message')
    const abort = new AbortController()
    this.aborts.set(sessionId, abort)
    const now = () => new Date().toISOString()
    this.push(s, { type: 'user', text, at: now() })
    if (s.transcript.filter((e) => e.type === 'user').length === 1) s.title = text.slice(0, 60)
    s.history.push({ role: 'user', content: text })

    const settings = this.ai.get()
    const accountIds = s.context.accountId ? [s.context.accountId] : undefined
    const toolDefs = this.tools.toDefinitions()
    const system = `${AGENT_SYSTEM}\n\n${this.contextBuilder(s.context)}`

    try {
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        if (abort.signal.aborted) break
        const r = await this.ai.chat('chat', { system, messages: s.history.slice(-MAX_HISTORY_MESSAGES), tools: toolDefs, maxTokens: 4000, accountIds, signal: abort.signal, cache: true }, (d) => this.emit('delta', s.id, d))
        s.history.push(r.assistantMessage)
        if (r.stopReason === 'refusal') {
          this.push(s, { type: 'error', text: `The model declined this request${r.refusal?.explanation ? `: ${r.refusal.explanation}` : '.'}`, at: now() })
          break
        }
        if (r.text.trim()) this.push(s, { type: 'assistant', text: r.text.trim(), at: now() })
        if (r.stopReason !== 'tool_use' || !r.toolCalls.length) break

        // Execute all tool calls, then return every result in ONE user message.
        const results: ContentPart[] = []
        for (const call of r.toolCalls) {
          const spec = this.tools.get(call.name)
          const summary = spec?.summarize?.(call.input as never) ?? `${call.name}(${JSON.stringify(call.input ?? {}).slice(0, 160)})`
          this.push(s, { type: 'tool_call', id: call.id, name: call.name, input: call.input, summary, at: now() })
          const res = await this.tools.run(
            call.name,
            call.input,
            {
              accountIds,
              caller: { kind: 'agent' },
              signal: abort.signal,
              confirm: (tool: ToolSpec, input: unknown, sum: string) => this.askConfirmation(s.id, tool, input, sum)
            },
            { autoApprove: settings.autoApproveTools }
          )
          const text = res.ok ? res.text : res.error
          this.push(s, { type: 'tool_result', id: call.id, name: call.name, ok: res.ok, text: text.slice(0, 2000), declined: !res.ok && res.declined, at: now() })
          results.push({ type: 'tool_result', toolUseId: call.id, content: text.slice(0, 60_000), isError: !res.ok })
        }
        s.history.push({ role: 'user', content: results })
        if (iter === MAX_ITERATIONS - 1) this.push(s, { type: 'error', text: 'Stopped after too many steps. Ask me to continue if needed.', at: now() })
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        const msg = e instanceof Error ? e.message : String(e)
        log.warn('agent turn failed', { msg })
        this.push(s, { type: 'error', text: msg, at: now() })
      }
    } finally {
      this.aborts.delete(sessionId)
      this.persist(s)
      this.emit('done', s.id)
    }
  }

  private askConfirmation(sessionId: string, tool: ToolSpec, input: unknown, summary: string): Promise<boolean> {
    const id = `${sessionId}:${newId('cf')}`
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve)
      this.emit('confirm', sessionId, { id, tool: tool.name, risk: tool.risk, summary, input })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          resolve(false)
        }
      }, 5 * 60_000)
    })
  }
}
