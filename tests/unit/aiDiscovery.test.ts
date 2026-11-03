import { describe, it, expect } from 'vitest'
import { candidateUrls, discoverLocalServers, suggestRoles } from '@kernel/ai/llm/discovery'
import { normalizeBaseUrl, extractJson, OpenAICompatProvider } from '@kernel/ai/llm/openaiCompat'
import { ToolRegistry, defineTool } from '@kernel/ai/tools/registry'
import { z } from 'zod'

/** Fake HTTP world: Ollama on 11434, vLLM with API key on 8000, nothing elsewhere. */
function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (url.includes(':11434')) {
      if (url.endsWith('/api/version')) return json(200, { version: '0.6.1' })
      if (url.endsWith('/api/tags')) return json(200, { models: [{ name: 'qwen2.5:7b', size: 4_700_000_000, details: { family: 'qwen2', parameter_size: '7.6B', quantization_level: 'Q4_K_M' } }, { name: 'nomic-embed-text', size: 274_000_000, details: { family: 'nomic-bert', parameter_size: '137M' } }] })
      if (url.endsWith('/api/show')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { model: string }
        return json(200, body.model.startsWith('qwen') ? { capabilities: ['completion', 'tools'], model_info: { 'qwen2.context_length': 32768 } } : { capabilities: ['embedding'] })
      }
      if (url.endsWith('/v1/chat/completions')) return json(200, { model: 'qwen2.5:7b', choices: [{ message: { content: '{"capital":"Paris"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } })
      return new Response('', { status: 404 })
    }
    if (url.includes(':8000')) {
      const path = new URL(url).pathname
      if (path === '/v1/models') return init?.headers && (init.headers as Record<string, string>)['Authorization'] ? json(200, { data: [{ id: 'meta-llama/Llama-3.1-8B-Instruct', max_model_len: 131072 }] }) : json(401, { error: 'unauthorized' })
      if (path === '/version') return json(200, { version: '0.8.3' })
      return new Response('', { status: 404 })
    }
    throw new TypeError('fetch failed')
  }) as typeof fetch
}

describe('local LLM discovery', () => {
  it('expands user input into candidate urls', () => {
    expect(candidateUrls('localhost', [11434, 8000])).toEqual(['http://localhost:11434', 'http://localhost:8000'])
    expect(candidateUrls('http://box:8000/v1')).toEqual(['http://box:8000'])
    expect(candidateUrls('http://llm.example.com:8000')).toEqual(['http://llm.example.com:8000', 'https://llm.example.com:8000'])
    expect(candidateUrls('https://llm.example.com')).toEqual(['https://llm.example.com'])
    expect(candidateUrls('192.168.1.5:11434')).toEqual(['http://192.168.1.5:11434'])
    expect(normalizeBaseUrl('gpu:11434/v1/')).toBe('http://gpu:11434')
  })

  it('fingerprints Ollama and a key-protected vLLM', async () => {
    const found = await discoverLocalServers('localhost', { fetchImpl: fakeFetch(), ports: [11434, 8000, 1234], timeoutMs: 500 })
    expect(found.map((f) => f.kind).sort()).toEqual(['ollama', 'vllm'])
    const ollama = found.find((f) => f.kind === 'ollama')!
    expect(ollama.version).toBe('0.6.1')
    expect(ollama.models.map((m) => m.id)).toEqual(['qwen2.5:7b', 'nomic-embed-text'])
    expect(ollama.models[0]!.capabilities).toMatchObject({ tools: true, contextTokens: 32768 })
    expect(ollama.models[1]!.capabilities.embeddings).toBe(true)
    const vllm = found.find((f) => f.kind === 'vllm')!
    expect(vllm.requiresApiKey).toBe(true)
    expect(vllm.models).toEqual([])
  })

  it('lists models once a key is supplied', async () => {
    const found = await discoverLocalServers('localhost:8000', { fetchImpl: fakeFetch(), apiKey: 'sk-test', timeoutMs: 500 })
    expect(found[0]!.models[0]).toMatchObject({ id: 'meta-llama/Llama-3.1-8B-Instruct', capabilities: { contextTokens: 131072 } })
  })

  it('suggests roles from the model list', () => {
    const roles = suggestRoles([
      { id: 'big:70b', label: '', family: null, parameterSize: '70B', quantization: null, sizeBytes: null, capabilities: { tools: true, json: null, vision: null, embeddings: null, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: null } },
      { id: 'small:3b', label: '', family: null, parameterSize: '3B', quantization: null, sizeBytes: null, capabilities: { tools: true, json: null, vision: null, embeddings: null, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: null } },
      { id: 'nomic-embed-text', label: '', family: null, parameterSize: '137M', quantization: null, sizeBytes: null, capabilities: { tools: null, json: null, vision: null, embeddings: true, contextTokens: null, tokensPerSecond: null, ttftMs: null, probedAt: null } }
    ])
    expect(roles).toMatchObject({ chat: 'big:70b', drafting: 'big:70b', triage: 'small:3b', embeddings: 'nomic-embed-text' })
  })

  it('parses structured output through the OpenAI-compatible provider', async () => {
    const p = new OpenAICompatProvider({ id: 'x', label: 'ollama', baseUrl: 'http://localhost:11434', serverKind: 'ollama', fetchImpl: fakeFetch() })
    const r = await p.chat({ model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'capital?' }], outputSchema: z.object({ capital: z.string() }) })
    expect(r.parsed).toEqual({ capital: 'Paris' })
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 3 })
    expect(extractJson('Sure! ```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('prefix {"b":2} suffix')).toEqual({ b: 2 })
  })
})

describe('ToolRegistry', () => {
  it('exports JSON schema, validates input and gates risky tools', async () => {
    const reg = new ToolRegistry().register(
      defineTool({ name: 'echo', description: 'echo', risk: 'read', input: z.object({ text: z.string().describe('t') }), handler: (i) => i.text }),
      defineTool({ name: 'nuke', description: 'danger', risk: 'destructive', input: z.object({}), handler: () => 'boom' })
    )
    const defs = reg.toDefinitions()
    expect(defs[0]!.inputSchema).toMatchObject({ type: 'object', required: ['text'], additionalProperties: false })
    expect(await reg.run('echo', { text: 'hi' }, { caller: { kind: 'agent' } })).toMatchObject({ ok: true, text: 'hi' })
    expect(await reg.run('echo', { nope: 1 }, { caller: { kind: 'agent' } })).toMatchObject({ ok: false })
    expect(await reg.run('nuke', {}, { caller: { kind: 'agent' } })).toMatchObject({ ok: false, declined: true })
    expect(await reg.run('nuke', {}, { caller: { kind: 'agent' }, confirm: async () => true })).toMatchObject({ ok: true, text: 'boom' })
    expect(await reg.run('nuke', {}, { caller: { kind: 'agent' } }, { autoApprove: ['nuke'] })).toMatchObject({ ok: true })
    expect(reg.list({ maxRisk: 'read' }).map((t) => t.name)).toEqual(['echo'])
  })
})

describe('privacy: isLocal', () => {
  const local = (u: string) => new OpenAICompatProvider({ id: 'x', label: u, baseUrl: u, serverKind: 'openai-compat' }).isLocal
  it('treats loopback, LAN ranges and local names as local', () => {
    for (const u of ['http://localhost:11434', 'http://127.0.0.1:8000', 'http://[::1]:8080', 'http://10.0.0.5:8000', 'http://192.168.1.20:1234', 'http://172.16.4.4:8000', 'http://host.docker.internal:11434', 'http://gpu-box:8000', 'http://ollama.lan:11434', 'https://server.local', '192.168.1.20:11434'])
      expect(local(u), u).toBe(true)
  })
  it('treats public IPs and public domains as cloud', () => {
    for (const u of ['http://203.0.113.5:8000', 'http://8.8.8.8', 'https://api.example.com', 'http://172.32.0.1:8000', 'https://my-vllm.ts.net'])
      expect(local(u), u).toBe(false)
  })
})
