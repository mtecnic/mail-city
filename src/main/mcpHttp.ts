/**
 * Localhost Streamable-HTTP MCP endpoint served by the running app.
 * One McpServer + transport per client session; bearer-token protected.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Kernel } from '@kernel/index'
import { createMcpServer, getMcpSettings, setMcpSettings } from '@kernel/ai/mcp/McpBridge'
import { PermissionBroker } from '@kernel/ai/mcp/PermissionBroker'
import { createLogger } from '@kernel/utils/logger'
import { emit } from './ipc/router'

const log = createLogger('mcp:http')
const TOKEN_KEY = 'mcp.token'

export class McpHttpServer {
  private server: Server | null = null
  private port = 0
  private sessions = new Map<string, { transport: StreamableHTTPServerTransport; client: string }>()
  readonly broker = new PermissionBroker(true)

  constructor(private readonly k: Kernel) {
    this.broker.on('confirm', (req) => emit('mcp.confirm', req))
  }

  token(): string {
    let t = this.k.vault.get(TOKEN_KEY)
    if (!t) {
      t = randomBytes(24).toString('base64url')
      this.k.vault.set(TOKEN_KEY, t)
    }
    return t
  }

  regenerateToken(): string {
    this.k.vault.set(TOKEN_KEY, randomBytes(24).toString('base64url'))
    return this.token()
  }

  get running(): boolean {
    return !!this.server
  }

  url(): string | null {
    return this.server ? `http://127.0.0.1:${this.port}/mcp` : null
  }

  sessionCount(): number {
    return this.sessions.size
  }

  async start(): Promise<void> {
    if (this.server) return
    const settings = getMcpSettings(this.k)
    const token = this.token()
    this.server = createServer((req, res) => void this.handle(req, res, token))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(settings.port || 0, '127.0.0.1', () => resolve())
    })
    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : settings.port
    if (!settings.port) setMcpSettings(this.k, { port: this.port })
    log.info('listening', { url: this.url() })
  }

  async stop(): Promise<void> {
    for (const s of this.sessions.values()) await s.transport.close().catch(() => {})
    this.sessions.clear()
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    this.server = null
  }

  private authorized(req: IncomingMessage, token: string): boolean {
    const h = req.headers.authorization ?? ''
    const m = h.match(/^Bearer\s+(.+)$/i)
    if (!m) return false
    const a = Buffer.from(m[1]!)
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/mcp') {
        res.writeHead(404).end()
        return
      }
      if (!this.authorized(req, token)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized')
        return
      }
      const sid = req.headers['mcp-session-id']
      const existing = typeof sid === 'string' ? this.sessions.get(sid) : undefined
      if (existing) {
        await existing.transport.handleRequest(req, res)
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(400).end('Missing session')
        return
      }
      // New session: parse the initialize request to learn the client name.
      const body = await readBody(req)
      let parsed: unknown = undefined
      try {
        parsed = JSON.parse(body)
      } catch {
        res.writeHead(400).end('Invalid JSON')
        return
      }
      const init = parsed as { method?: string; params?: { clientInfo?: { name?: string } } }
      const clientName = init?.params?.clientInfo?.name ?? 'mcp-client'
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${this.port}`, `localhost:${this.port}`, '127.0.0.1', 'localhost'],
        onsessioninitialized: (id) => {
          this.sessions.set(id, { transport, client: clientName })
          emit('mcp.status', this.status())
          log.info('session opened', { client: clientName })
        }
      })
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId)
        emit('mcp.status', this.status())
      }
      const server = createMcpServer(this.k, this.broker, () => clientName)
      await server.connect(transport)
      await transport.handleRequest(req, res, parsed)
    } catch (e) {
      log.warn('request failed', { error: String(e) })
      if (!res.headersSent) res.writeHead(500).end('Internal error')
    }
  }

  status() {
    return { httpRunning: this.running, url: this.url(), sessions: this.sessionCount(), stdioCommand: `${process.execPath} --mcp`, hasToken: this.k.vault.has(TOKEN_KEY) }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
