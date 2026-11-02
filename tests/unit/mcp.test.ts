import { describe, it, expect, afterEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import { createMcpServer, getMcpSettings, setMcpSettings } from '@kernel/ai/mcp/McpBridge'
import { PermissionBroker } from '@kernel/ai/mcp/PermissionBroker'
import type { HeaderRecord } from '@kernel/providers/ImapProvider'

describe('MCP bridge', () => {
  let k: Kernel
  afterEach(async () => k?.shutdown())

  it('exposes tools, resources and prompts; gates writes in headless mode', async () => {
    k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    const acct = k.accounts.create({ type: 'imap', email: 'me@test', displayName: 'Me', imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
    const inbox = k.store.upsertFolder({ id: 'f1', accountId: acct.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
    const h: HeaderRecord = { uid: 1, modseq: undefined, flags: new Set(), labels: undefined, threadId: undefined, size: 10, internalDate: new Date(), bodyStructure: undefined, headers: {}, envelope: { subject: 'Invoice 42', messageId: '<a@b>', from: [{ name: 'Acme', address: 'billing@acme.test' }], to: [{ address: 'me@test' }], date: new Date() } }
    const { id } = k.store.upsertHeader(acct.id, inbox.id, h)

    const server = createMcpServer(k, new PermissionBroker(false), () => 'test-client')
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await server.connect(serverT)
    const client = new Client({ name: 'test-client', version: '1.0' })
    await client.connect(clientT)

    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['mail_search', 'mail_get_message', 'mail_archive', 'mail_send']))
    expect(tools.tools.find((t) => t.name === 'mail_send')?.annotations?.destructiveHint).toBe(true)

    const search = await client.callTool({ name: 'mail_search', arguments: { query: 'invoice' } })
    expect(JSON.parse((search.content as { text: string }[])[0]!.text)[0]).toMatchObject({ id, subject: 'Invoice 42' })

    // Write tool without allowlist in headless mode → denied, not executed.
    const flags = await client.callTool({ name: 'mail_set_flags', arguments: { ids: [id], seen: true } })
    expect(flags.isError).toBe(true)
    expect(k.store.getMessage(id)!.flags.seen).toBe(false)

    // Allow-list it for this client → runs.
    setMcpSettings(k, { clients: { 'test-client': { allowTools: ['mail_set_flags'], lastSeenAt: null } } })
    const flags2 = await client.callTool({ name: 'mail_set_flags', arguments: { ids: [id], seen: true } })
    expect(flags2.isError).toBeFalsy()
    expect(k.store.getMessage(id)!.flags.seen).toBe(true)
    expect(getMcpSettings(k).clients['test-client']?.lastSeenAt).toBeTruthy()

    const res = await client.listResourceTemplates()
    expect(res.resourceTemplates.map((r) => r.uriTemplate)).toEqual(expect.arrayContaining(['mail://msg/{id}', 'mail://thread/{id}']))
    const prompts = await client.listPrompts()
    expect(prompts.prompts.map((p) => p.name)).toEqual(expect.arrayContaining(['summarize-thread', 'draft-reply', 'triage-inbox']))
    await client.close()
  })
})
