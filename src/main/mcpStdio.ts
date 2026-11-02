/**
 * `MailCity.exe --mcp`: headless MCP server over stdio for Claude Desktop /
 * Claude Code. Opens the same database as the app (SQLite WAL handles the
 * concurrency); writes it queues are picked up by the running app's sync
 * engine, or by the next app launch.
 */
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Kernel } from '@kernel/index'
import { setLogSink } from '@kernel/utils/logger'
import { createMcpServer } from '@kernel/ai/mcp/McpBridge'
import { PermissionBroker } from '@kernel/ai/mcp/PermissionBroker'
import { electronCipher } from './cipher'

export async function runMcpStdio(): Promise<void> {
  // stdout is the protocol channel: all logging must go to stderr.
  setLogSink({ log: (level, scope, message, meta) => process.stderr.write(`[${level}] [${scope}] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`) })
  await app.whenReady()
  const dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })
  const kernel = new Kernel({ dataDir, cipher: electronCipher(safeStorage), autoSync: false })
  const broker = new PermissionBroker(false) // no UI: only allow-listed write tools run
  const server = createMcpServer(kernel, broker, () => 'stdio')
  const transport = new StdioServerTransport()
  await server.connect(transport)
  const shutdown = async () => {
    await kernel.shutdown().catch(() => {})
    app.exit(0)
  }
  transport.onclose = () => void shutdown()
  process.stdin.on('end', () => void shutdown())
}
