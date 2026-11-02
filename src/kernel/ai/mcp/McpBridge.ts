/**
 * Exposes the tool registry, mail resources and a few prompts as an MCP server.
 * One McpServer instance is created per connected client/session.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Kernel } from '../../index'
import type { ToolSpec } from '../tools/registry'
import { McpSettingsSchema, type McpSettings, type McpSettingsPatch } from '@shared/schemas/mcp'
import type { PermissionBroker } from './PermissionBroker'
import { htmlToText } from '../../mail/text'
import { createLogger } from '../../utils/logger'

const log = createLogger('mcp')
const SETTINGS_KEY = 'mcp'

export function getMcpSettings(k: Kernel): McpSettings {
  return k.settings.getValue(SETTINGS_KEY, McpSettingsSchema)
}

export function setMcpSettings(k: Kernel, patch: McpSettingsPatch): McpSettings {
  const next = McpSettingsSchema.parse({ ...getMcpSettings(k), ...patch })
  k.settings.setValue(SETTINGS_KEY, next)
  return next
}

export function createMcpServer(k: Kernel, broker: PermissionBroker, clientName: () => string): McpServer {
  const server = new McpServer({ name: 'mail-city', version: '1.0.0' }, { instructions: 'Tools and resources for the user\'s email (Mail City). Search or list before reading; prefer drafts over sending; destructive actions require the user to confirm in the app.' })

  // ---- tools ----------------------------------------------------------------
  for (const spec of k.tools.list()) registerTool(server, k, broker, spec, clientName)

  // ---- resources --------------------------------------------------------------
  server.registerResource(
    'message',
    new ResourceTemplate('mail://msg/{id}', { list: undefined }),
    { title: 'Email message', description: 'A single email as plain text with headers.', mimeType: 'text/plain' },
    async (uri, vars) => {
      const d = await k.mail.get(String(vars['id']))
      guardAccount(k, d.accountId)
      const body = d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : '')
      const text = `From: ${d.from.name} <${d.from.address}>\nTo: ${d.to.map((a) => a.address).join(', ')}\nDate: ${d.date}\nSubject: ${d.subject}\n\n${body}`
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] }
    }
  )
  server.registerResource(
    'thread',
    new ResourceTemplate('mail://thread/{id}', { list: undefined }),
    { title: 'Email thread', description: 'Every message in a thread, oldest first.', mimeType: 'text/plain' },
    async (uri, vars) => {
      const items = k.mail.thread(String(vars['id']))
      const parts: string[] = []
      for (const it of items) {
        const d = await k.mail.get(it.id)
        guardAccount(k, d.accountId)
        parts.push(`--- ${d.date} · ${d.from.name} <${d.from.address}> ---\nSubject: ${d.subject}\n\n${(d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : '')).slice(0, 8000)}`)
      }
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: parts.join('\n\n') }] }
    }
  )
  server.registerResource(
    'inbox',
    'mail://inbox',
    { title: 'Unified inbox', description: 'The 50 most recent inbox messages across accounts (one line each).', mimeType: 'text/plain' },
    async (uri) => {
      const scope = getMcpSettings(k).accountIds
      const rows = k.store.list({ specialUse: 'inbox', limit: 50 }).filter((m) => !scope.length || scope.includes(m.accountId))
      const text = rows.map((m) => `${m.flags.seen ? ' ' : '*'} ${m.date.slice(0, 16)}  ${(m.from.name || m.from.address).slice(0, 24).padEnd(24)}  ${m.subject.slice(0, 70)}  mail://msg/${m.id}`).join('\n')
      return { contents: [{ uri: uri.href, mimeType: 'text/plain', text }] }
    }
  )

  // ---- prompts ----------------------------------------------------------------
  server.registerPrompt('summarize-thread', { title: 'Summarize a thread', description: 'Summarize an email thread by id.', argsSchema: { threadId: k.tools.get('mail_get_thread')!.input.shape['threadId'] as never } }, ({ threadId }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Read mail://thread/${threadId} (use mail_get_thread) and summarize it in 3–5 bullets: who wants what, decisions, open questions, deadlines, and what I must do.` } }]
  }))
  server.registerPrompt('draft-reply', { title: 'Draft a reply', description: 'Draft a reply to a message.', argsSchema: { messageId: k.tools.get('mail_get_message')!.input.shape['id'] as never } }, ({ messageId }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Read mail://msg/${messageId} with mail_get_message, then draft a concise reply in my voice using mail_create_draft (do not send). Tell me what you drafted.` } }]
  }))
  server.registerPrompt('triage-inbox', { title: 'Triage my inbox', description: 'Review recent inbox mail and propose actions.' }, () => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'List my recent unread inbox mail with mail_list (unreadOnly), group it into: needs my reply, FYI, newsletters/notifications, and propose which to archive. Ask before archiving.' } }]
  }))

  return server
}

function registerTool(server: McpServer, k: Kernel, broker: PermissionBroker, spec: ToolSpec, clientName: () => string) {
  server.registerTool(
    spec.name,
    {
      title: spec.name.replace(/_/g, ' '),
      description: spec.description,
      inputSchema: spec.input as never,
      annotations: { readOnlyHint: spec.risk === 'read', destructiveHint: spec.risk === 'destructive', openWorldHint: false }
    },
    (async (input: unknown, _extra?: unknown) => {
      const client = clientName()
      const settings = getMcpSettings(k)
      const allow = settings.clients[client]?.allowTools ?? []
      const res = await k.tools.run(
        spec.name,
        input,
        {
          accountIds: settings.accountIds.length ? settings.accountIds : undefined,
          caller: { kind: 'mcp', name: client },
          confirm: async (tool, inp, summary) => {
            const answer = await broker.ask(client, tool, inp, summary)
            if (answer === 'always') {
              const cur = getMcpSettings(k)
              const entry = cur.clients[client] ?? { allowTools: [], lastSeenAt: null }
              setMcpSettings(k, { clients: { ...cur.clients, [client]: { ...entry, allowTools: [...new Set([...entry.allowTools, tool.name])] } } })
              return true
            }
            return answer
          }
        },
        { autoApprove: allow }
      )
      touchClient(k, client)
      if (!res.ok) {
        log.info('mcp tool failed', { client, tool: spec.name, error: res.error })
        return { content: [{ type: 'text' as const, text: res.error }], isError: true }
      }
      return { content: [{ type: 'text' as const, text: res.text }] }
    }) as never
  )
}

function guardAccount(k: Kernel, accountId: string) {
  const scope = getMcpSettings(k).accountIds
  if (scope.length && !scope.includes(accountId)) throw new Error('This account is not shared with MCP clients')
}

function touchClient(k: Kernel, client: string) {
  const cur = getMcpSettings(k)
  const entry = cur.clients[client] ?? { allowTools: [], lastSeenAt: null }
  const now = new Date().toISOString()
  if (!entry.lastSeenAt || Date.now() - new Date(entry.lastSeenAt).getTime() > 60_000) {
    setMcpSettings(k, { clients: { ...cur.clients, [client]: { ...entry, lastSeenAt: now } } })
  }
}
