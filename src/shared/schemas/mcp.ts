import { z } from 'zod'

export const McpSettingsSchema = z.object({
  /** Serve MCP over localhost Streamable HTTP while the app runs. */
  httpEnabled: z.boolean().default(false),
  /** 0 = pick a free port once and remember it. */
  port: z.number().int().min(0).max(65535).default(0),
  /** Per-client tool allowlist (tools that run without asking). Key = client name as reported by the MCP client. */
  clients: z.record(z.string(), z.object({ allowTools: z.array(z.string()).default([]), lastSeenAt: z.string().nullable().default(null) })).prefault({}),
  /** Restrict MCP clients to these accounts (empty = all). */
  accountIds: z.array(z.string()).default([])
})
export type McpSettings = z.output<typeof McpSettingsSchema>
export type McpSettingsPatch = z.input<typeof McpSettingsSchema>

export const McpStatusSchema = z.object({
  httpRunning: z.boolean(),
  url: z.string().nullable(),
  sessions: z.number(),
  stdioCommand: z.string(),
  hasToken: z.boolean()
})
export type McpStatus = z.output<typeof McpStatusSchema>
