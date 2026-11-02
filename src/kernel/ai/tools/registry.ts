/**
 * One tool registry, many consumers: the in-app assistant (Claude or a local
 * model), the MCP server, and the UI's own actions all share these definitions.
 */
import { z } from 'zod'
import type { ToolDefinition } from '../llm/types'

export type ToolRisk = 'read' | 'write' | 'destructive'

export interface ToolContext {
  /** Restrict reads/writes to these accounts (undefined = all). */
  accountIds?: string[]
  /** Who is calling: the in-app agent, an MCP client (name), or a rule. */
  caller: { kind: 'agent' | 'mcp' | 'feature'; name?: string }
  /** Ask the user to confirm a risky action. Returns false when declined. */
  confirm?: (tool: ToolSpec, input: unknown, summary: string) => Promise<boolean>
  signal?: AbortSignal
}

export interface ToolSpec<I extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>, O = unknown> {
  name: string
  description: string
  risk: ToolRisk
  input: I
  /** Short human-readable summary of what running this call would do (shown in confirmations and transcripts). */
  summarize?: (input: z.output<I>) => string
  handler: (input: z.output<I>, ctx: ToolContext) => Promise<O> | O
}

export function defineTool<I extends z.ZodObject<z.ZodRawShape>, O>(spec: ToolSpec<I, O>): ToolSpec<I, O> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)) throw new Error(`Invalid tool name ${spec.name}`)
  return spec
}

export class ToolDeclined extends Error {
  constructor(tool: string) {
    super(`The user declined to run ${tool}`)
    this.name = 'ToolDeclined'
  }
}

/** Recursively set additionalProperties:false on every object schema (required for strict tool use). */
function closeObjects(node: unknown): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach(closeObjects)
    return
  }
  const o = node as Record<string, unknown>
  if (o['type'] === 'object' && o['properties'] && o['additionalProperties'] === undefined) o['additionalProperties'] = false
  for (const v of Object.values(o)) closeObjects(v)
}

export class ToolRegistry {
  private tools = new Map<string, ToolSpec>()

  register(...specs: ToolSpec<any, any>[]): this {
    for (const s of specs as unknown as ToolSpec[]) this.tools.set(s.name, s)
    return this
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)
  }

  list(filter?: { maxRisk?: ToolRisk; names?: string[] }): ToolSpec[] {
    const order: ToolRisk[] = ['read', 'write', 'destructive']
    return [...this.tools.values()].filter((t) => (!filter?.maxRisk || order.indexOf(t.risk) <= order.indexOf(filter.maxRisk)) && (!filter?.names || filter.names.includes(t.name)))
  }

  /** JSON Schema for a tool's input (draft 2020-12, additionalProperties:false — valid for strict tool use). */
  static inputSchema(spec: ToolSpec): Record<string, unknown> {
    const schema = z.toJSONSchema(spec.input, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>
    delete schema['$schema']
    closeObjects(schema)
    return schema
  }

  toDefinitions(filter?: { maxRisk?: ToolRisk; names?: string[] }): ToolDefinition[] {
    return this.list(filter).map((t) => ({ name: t.name, description: t.description, inputSchema: ToolRegistry.inputSchema(t) }))
  }

  /** Validate input, enforce confirmation for risky tools, run, and return a compact string result. */
  async run(name: string, rawInput: unknown, ctx: ToolContext, opts: { autoApprove?: string[] } = {}): Promise<{ ok: true; result: unknown; text: string } | { ok: false; error: string; declined?: boolean }> {
    const spec = this.tools.get(name)
    if (!spec) return { ok: false, error: `Unknown tool ${name}` }
    const parsed = spec.input.safeParse(rawInput ?? {})
    if (!parsed.success) return { ok: false, error: `Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }
    const input = parsed.data
    const summary = spec.summarize?.(input) ?? `${name}(${JSON.stringify(input).slice(0, 200)})`
    if (spec.risk !== 'read' && !opts.autoApprove?.includes(name)) {
      if (!ctx.confirm) return { ok: false, error: `${name} needs user confirmation but no confirmation channel is available`, declined: true }
      const ok = await ctx.confirm(spec, input, summary)
      if (!ok) return { ok: false, error: `User declined: ${summary}`, declined: true }
    }
    try {
      const result = await spec.handler(input, ctx)
      return { ok: true, result, text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
