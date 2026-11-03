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

describe('MCP account scoping', () => {
  let k: Kernel
  afterEach(async () => k?.shutdown())

  function header(subject: string, from: string, to: string, mid: string): HeaderRecord {
    return { uid: 1, modseq: undefined, flags: new Set(), labels: undefined, threadId: undefined, size: 10, internalDate: new Date(), bodyStructure: undefined, headers: {}, envelope: { subject, messageId: mid, from: [{ name: from, address: from }], to: [{ address: to }], date: new Date() } }
  }

  it('tools never reach past the shared accounts: move, rules, replies, contacts', async () => {
    k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
    const mk = (email: string) => k.accounts.create({ type: 'imap', email, displayName: email, imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
    const shared = mk('shared@test')
    const secret = mk('secret@test')
    const sharedInbox = k.store.upsertFolder({ id: 'f-shared', accountId: shared.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
    const secretInbox = k.store.upsertFolder({ id: 'f-secret', accountId: secret.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
    const secretArchive = k.store.upsertFolder({ id: 'f-secret-arch', accountId: secret.id, path: 'Archive', name: 'Archive', delimiter: '/', specialUse: 'archive', subscribed: true, sortOrder: 1 })
    const sharedMsg = k.store.upsertHeader(shared.id, sharedInbox.id, header('Public', 'alice@pub.test', 'shared@test', '<1@s>'))
    const secretMsg = k.store.upsertHeader(secret.id, secretInbox.id, header('Private', 'mallory@priv.test', 'secret@test', '<2@s>'))
    k.contacts.harvest([{ name: 'alice', address: 'alice@pub.test' }], 'received', new Date())
    k.contacts.harvest([{ name: 'mallory', address: 'mallory@priv.test' }], 'received', new Date())

    setMcpSettings(k, { accountIds: [shared.id], clients: { c: { allowTools: ['mail_move', 'rules_create', 'mail_create_draft', 'mail_set_flags'], lastSeenAt: null } } })
    const server = createMcpServer(k, new PermissionBroker(false), () => 'c')
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    await server.connect(serverT)
    const client = new Client({ name: 'c', version: '1.0' })
    await client.connect(clientT)
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args })
      return { error: !!r.isError, text: (r.content as { text: string }[])[0]!.text }
    }

    // Move: destination folder in an unshared account.
    expect(await call('mail_move', { ids: [sharedMsg.id], toFolderId: secretArchive.id })).toMatchObject({ error: true, text: expect.stringMatching(/not accessible/) })
    // Rules: default scope is the shared accounts, never "all"; unshared ids and folders are rejected.
    const rule = await call('rules_create', { name: 'r', conditions: [{ field: 'subject', op: 'contains', value: 'x' }], actions: [{ type: 'markRead' }] })
    expect(rule.error).toBe(false)
    expect(k.rules.list()[0]!.accountIds).toEqual([shared.id])
    expect((await call('rules_create', { name: 'r2', conditions: [{ field: 'subject', op: 'contains', value: 'x' }], actions: [{ type: 'markRead' }], accountIds: [secret.id] })).error).toBe(true)
    expect((await call('rules_create', { name: 'r3', conditions: [{ field: 'subject', op: 'contains', value: 'x' }], actions: [{ type: 'move', folderId: secretArchive.id }] })).error).toBe(true)
    // Replies: the quoted message must be readable and belong to the sending account.
    expect((await call('mail_create_draft', { accountId: shared.id, to: ['x@y'], subject: 's', body: 'b', inReplyToMessageId: secretMsg.id })).error).toBe(true)
    expect((await call('mail_create_draft', { accountId: shared.id, to: ['x@y'], subject: 's', body: 'b', inReplyToMessageId: sharedMsg.id })).error).toBe(false)
    // Contacts: only people seen in shared mail.
    const people = JSON.parse((await call('contacts_search', { query: 'test' })).text) as { email: string }[]
    expect(people.map((p) => p.email)).toEqual(['alice@pub.test'])
    await client.close()
  })
})
