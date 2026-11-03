import { describe, it, expect, afterEach } from 'vitest'
import { Kernel } from '@kernel/index'
import { plainCipher } from '@kernel/accounts/SecretStore'
import type { HeaderRecord } from '@kernel/providers/ImapProvider'

function makeKernel() {
  const k = new Kernel({ dataDir: '/tmp', dbPath: ':memory:', cipher: plainCipher, autoSync: false })
  const mk = (email: string) => k.accounts.create({ type: 'imap', email, displayName: email, imap: { host: 'x', port: 993, tls: 'tls' }, smtp: { host: 'x', port: 587, tls: 'starttls' }, auth: { type: 'password', password: 'p' } })
  const work = mk('work@test')
  const home = mk('home@test')
  // One cloud provider (public host) and one local provider.
  const cloud = k.ai.upsertProvider({ kind: 'openai-compat', label: 'cloud', baseUrl: 'https://llm.example.com', enabled: true, models: [{ id: 'big', label: 'big', family: null, parameterSize: '70B', quantization: null, sizeBytes: null, capabilities: { tools: true, json: null, vision: null, embeddings: null, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: null } }] })
  const local = k.ai.upsertProvider({ kind: 'openai-compat', label: 'local', baseUrl: 'http://localhost:11434', enabled: true, models: [{ id: 'small', label: 'small', family: null, parameterSize: '3B', quantization: null, sizeBytes: null, capabilities: { tools: true, json: null, vision: null, embeddings: null, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: null } }] })
  return { k, work, home, cloud, local }
}

describe('AI privacy policy', () => {
  let k: Kernel
  afterEach(async () => k?.shutdown())

  it('accountsAllowedFor: cloud providers only see cloud-allowed accounts, local providers see all', () => {
    const s = makeKernel()
    k = s.k
    k.ai.set({ privacy: { mode: 'cloud-allowed', perAccount: { [s.work.id]: 'local-only' } } })
    expect(k.ai.accountsAllowedFor(k.ai.provider(s.cloud.id))).toEqual([s.home.id])
    expect(k.ai.accountsAllowedFor(k.ai.provider(s.local.id)).sort()).toEqual([s.work.id, s.home.id].sort())
    expect(k.ai.accountsAllowedFor(k.ai.provider(s.cloud.id), [s.work.id])).toEqual([])
    k.ai.set({ privacy: { mode: 'local-only' } })
    expect(k.ai.accountsAllowedFor(k.ai.provider(s.cloud.id))).toEqual([])
  })

  it('routeFor falls back to a local provider for a local-only account', () => {
    const s = makeKernel()
    k = s.k
    k.ai.set({ privacy: { mode: 'cloud-allowed', perAccount: { [s.work.id]: 'local-only' } }, routes: { chat: { providerId: s.cloud.id, model: 'big' } } })
    expect(k.ai.routeFor('chat', [s.home.id])?.provider.id).toBe(s.cloud.id)
    expect(k.ai.routeFor('chat', [s.work.id])?.provider.id).toBe(s.local.id)
    expect(k.ai.routeFor('chat', [])?.provider.id).toBe(s.cloud.id)
  })

  it('the assistant routed to a cloud model cannot read local-only accounts, even in the unified view', async () => {
    const s = makeKernel()
    k = s.k
    k.ai.set({ privacy: { mode: 'cloud-allowed', perAccount: { [s.work.id]: 'local-only' } }, routes: { chat: { providerId: s.cloud.id, model: 'big' } } })
    const inbox = k.store.upsertFolder({ id: 'f-work', accountId: s.work.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
    const h: HeaderRecord = { uid: 1, modseq: undefined, flags: new Set(), labels: undefined, threadId: undefined, size: 10, internalDate: new Date(), bodyStructure: undefined, headers: {}, envelope: { subject: 'Secret', messageId: '<s@w>', from: [{ name: 'Boss', address: 'boss@work' }], to: [{ address: 'work@test' }], date: new Date() } }
    const { id } = k.store.upsertHeader(s.work.id, inbox.id, h)

    // Intercept the model call: the "model" asks to read the secret message, then stops.
    const seen: string[][] = []
    const provider = k.ai.provider(s.cloud.id)
    let turn = 0
    provider.chat = async (req) => {
      turn++
      seen.push([...(req.messages.length ? [String(req.messages.length)] : [])])
      if (turn === 1) return { text: '', assistantMessage: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mail_get_message', input: { id } }] }, toolCalls: [{ id: 't1', name: 'mail_get_message', input: { id } }], stopReason: 'tool_use', model: 'big', usage: { inputTokens: 1, outputTokens: 1 } }
      return { text: 'done', assistantMessage: { role: 'assistant', content: 'done' }, toolCalls: [], stopReason: 'end', model: 'big', usage: { inputTokens: 1, outputTokens: 1 } }
    }
    const session = k.agent.create({})
    const events: { type: string; ok?: boolean; text?: string }[] = []
    k.agent.on('event', (_id, ev) => events.push(ev as never))
    await k.agent.send(session.id, 'read my secret mail')
    const result = events.find((e) => e.type === 'tool_result')
    expect(result?.ok).toBe(false)
    expect(result?.text).toMatch(/not accessible/)

    // A session opened on the local-only account never uses the cloud route: with no local
    // provider available it refuses instead of falling through to Claude.
    k.ai.upsertProvider({ id: s.local.id, kind: 'openai-compat', enabled: false })
    const s2 = k.agent.create({ accountId: s.work.id })
    const errs: string[] = []
    k.agent.on('event', (_id, ev) => ev.type === 'error' && errs.push(ev.text))
    await k.agent.send(s2.id, 'hi')
    expect(errs.join(' ')).toMatch(/privacy settings/)
    expect(turn).toBe(2)
  })

  it('askMail never hands local-only mail to a cloud model', async () => {
    const s = makeKernel()
    k = s.k
    k.ai.set({ privacy: { mode: 'cloud-allowed', perAccount: { [s.work.id]: 'local-only' } }, routes: { chat: { providerId: s.cloud.id, model: 'big' } } })
    for (const [acct, subj] of [[s.work, 'Budget secret'], [s.home, 'Budget holiday']] as const) {
      const f = k.store.upsertFolder({ id: `f-${acct.id}`, accountId: acct.id, path: 'INBOX', name: 'Inbox', delimiter: '/', specialUse: 'inbox', subscribed: true, sortOrder: 0 })
      k.store.upsertHeader(acct.id, f.id, { uid: 1, modseq: undefined, flags: new Set(), labels: undefined, threadId: undefined, size: 10, internalDate: new Date(), bodyStructure: undefined, headers: {}, envelope: { subject: subj, messageId: `<${acct.id}>`, from: [{ name: 'X', address: 'x@y' }], to: [{ address: acct.email }], date: new Date() } })
    }
    let prompt = ''
    k.ai.provider(s.cloud.id).chat = async (req) => {
      prompt = JSON.stringify(req.messages)
      return { text: 'answer', assistantMessage: { role: 'assistant', content: 'answer' }, toolCalls: [], stopReason: 'end', model: 'big', usage: { inputTokens: 1, outputTokens: 1 } }
    }
    const { askMail } = await import('@kernel/ai/features/askMail')
    const r = await askMail(k, 'what about the budget?')
    expect(r.sources.map((x) => x.subject)).toEqual(['Budget holiday'])
    expect(prompt).not.toContain('Budget secret')
  })
})
