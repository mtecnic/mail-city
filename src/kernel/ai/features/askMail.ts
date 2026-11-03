/**
 * "Ask my mail": retrieval-augmented answers over the local cache with citations.
 */
import type { Kernel } from '../../index'
import { LLMError, type StreamDelta } from '../llm/types'
import { htmlToText } from '../../mail/text'
import { ASK_MAIL_SYSTEM } from '../prompts'
import { rrf } from '../embeddings/Indexer'

const STOP = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'from', 'that', 'this', 'there', 'their', 'have', 'does', 'did', 'will', 'should', 'could', 'would', 'tell', 'show', 'find', 'mail', 'email', 'emails', 'message', 'messages'])

export interface AskMailResult {
  answer: string
  sources: { n: number; id: string; subject: string; from: string; date: string }[]
}

export async function askMail(k: Kernel, question: string, opts: { accountId?: string; limit?: number } = {}, onDelta?: (d: StreamDelta) => void): Promise<AskMailResult> {
  // Privacy: decide which accounts the answering model may read before retrieving anything.
  const route = k.ai.routeFor('chat', opts.accountId ? [opts.accountId] : [])
  if (!route) throw new LLMError(k.ai.get().enabled ? 'No AI model is available for this feature under the current privacy settings. Configure one in Settings → AI.' : 'AI features are disabled in Settings → AI.', 'unsupported')
  const allowed = new Set(k.ai.accountsAllowedFor(route.provider, opts.accountId ? [opts.accountId] : undefined))
  const permitted = (h: { accountId: string }) => allowed.has(h.accountId)
  // Retrieval: hybrid when the vector index exists, otherwise FTS with a loosened query.
  let hits = (await k.indexer.hybrid(question, opts.limit ?? 8)).filter(permitted)
  if (!hits.length) {
    // The query language has no OR, so search each significant word and fuse the lists.
    const terms = question
      .replace(/[?.,!"]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()))
      .slice(0, 6)
    const lists = terms.map((t) => k.search.search(t, { limit: opts.limit ?? 8, accountId: opts.accountId }).map((m) => m.id))
    hits = k.store.listByIds(rrf(lists).slice(0, opts.limit ?? 8)).filter(permitted)
  }
  const sources: AskMailResult['sources'] = []
  const excerpts: string[] = []
  let n = 0
  for (const h of hits) {
    const d = await k.mail.get(h.id, { fetchBody: n < 4 })
    const body = (d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : '') ?? h.snippet ?? '').slice(0, 1800)
    n++
    sources.push({ n, id: d.id, subject: d.subject, from: d.from.name || d.from.address, date: d.date })
    excerpts.push(`[${n}] From: ${d.from.name} <${d.from.address}> · ${d.date} · Subject: ${d.subject}\n${body}`)
  }
  if (!excerpts.length) return { answer: 'I could not find any messages related to that. Try different words, or a search like from:someone subject:topic.', sources: [] }
  const r = await k.ai.chat(
    'chat',
    { system: ASK_MAIL_SYSTEM, messages: [{ role: 'user', content: `Question: ${question}\n\nEmail excerpts:\n\n${excerpts.join('\n\n')}` }], maxTokens: 800, accountIds: [...new Set(hits.map((h) => h.accountId))], messageIds: hits.map((h) => h.id) },
    onDelta
  )
  return { answer: r.text.trim(), sources }
}
