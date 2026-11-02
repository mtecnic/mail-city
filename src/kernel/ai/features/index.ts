/**
 * AI features: pure functions over the kernel + the routed provider.
 * Each one builds a prompt, calls AiService.chat for the right feature,
 * validates structured output, and stores results where it makes sense.
 */
import { z } from 'zod'
import type { Kernel } from '../../index'
import type { MessageDetail } from '../../mail/MessageService'
import type { MessageListItem } from '../../mail/MessageStore'
import { htmlToText } from '../../mail/text'
import { formatAddress } from '../../mail/addresses'
import type { StreamDelta } from '../llm/types'
import * as P from '../prompts'
import { RuleInputSchema, type RuleInputParsed } from '@shared/schemas/rules'
import { createLogger } from '../../utils/logger'

const log = createLogger('ai:features')
const MAX_BODY = 6000

function bodyText(d: MessageDetail, max = MAX_BODY): string {
  const t = d.textPlain ?? (d.textHtml ? htmlToText(d.textHtml) : '')
  return t.length > max ? `${t.slice(0, max)}\n[…truncated]` : t
}

function renderMessage(d: MessageDetail, max?: number): string {
  return `From: ${formatAddress(d.from)}\nTo: ${d.to.map(formatAddress).join(', ')}${d.cc.length ? `\nCc: ${d.cc.map(formatAddress).join(', ')}` : ''}\nDate: ${d.date}\nSubject: ${d.subject}\n\n${bodyText(d, max)}`
}

// ---- summarize ---------------------------------------------------------------

export async function summarizeThread(k: Kernel, messageId: string, onDelta?: (d: StreamDelta) => void): Promise<string> {
  const m = k.store.getMessage(messageId)
  if (!m) throw new Error('Message not found')
  const items = m.threadId ? k.mail.thread(m.threadId) : [{ id: messageId } as MessageListItem]
  const details: MessageDetail[] = []
  for (const it of items.slice(-12)) details.push(await k.mail.get(it.id))
  const text = details.map((d, i) => `--- Message ${i + 1} ---\n${renderMessage(d, 4000)}`).join('\n\n')
  const r = await k.ai.chat('summarize', { system: P.SUMMARIZE_SYSTEM, messages: [{ role: 'user', content: text }], maxTokens: 600, accountIds: [m.accountId], messageIds: details.map((d) => d.id) }, onDelta)
  const summary = r.text.trim()
  for (const d of details) k.store.setAiSummary(d.id, summary)
  return summary
}

// ---- triage ------------------------------------------------------------------

export const TriageItemSchema = z.object({
  id: z.string(),
  category: z.enum(['primary', 'needs_reply', 'newsletter', 'notification', 'promotion', 'receipt', 'social', 'spam_like']),
  priority: z.number().int().min(0).max(3),
  actionItems: z.array(z.string()).max(3).default([])
})
export const TriageOutputSchema = z.object({ items: z.array(TriageItemSchema) })

export async function triageMessages(k: Kernel, messageIds: string[]): Promise<z.output<typeof TriageItemSchema>[]> {
  const rows = messageIds.map((id) => k.store.getMessage(id)).filter((m): m is NonNullable<typeof m> => !!m)
  if (!rows.length) return []
  const out: z.output<typeof TriageItemSchema>[] = []
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20)
    const listing = batch
      .map((m, j) => `[${j}] id=${m.id}\nFrom: ${m.fromName} <${m.fromAddr}>\nSubject: ${m.subject}\nList-Id: ${m.listId ?? '-'}\nSnippet: ${m.snippet.slice(0, 300)}`)
      .join('\n\n')
    try {
      const r = await k.ai.chat('triage', {
        system: P.TRIAGE_SYSTEM,
        messages: [{ role: 'user', content: `Classify these ${batch.length} emails. Return {"items":[{id, category, priority, actionItems}]} with every id.\n\n${listing}` }],
        outputSchema: TriageOutputSchema,
        maxTokens: 2000,
        fast: true,
        accountIds: [...new Set(batch.map((m) => m.accountId))],
        messageIds: batch.map((m) => m.id)
      })
      const parsed = (r.parsed as z.output<typeof TriageOutputSchema> | undefined)?.items ?? []
      for (const item of parsed) {
        if (!batch.some((m) => m.id === item.id)) continue
        k.store.setAiCategory(item.id, item.category, item.priority)
        out.push(item)
      }
    } catch (e) {
      log.warn('triage batch failed', { error: String(e) })
    }
  }
  return out
}

// ---- drafting ----------------------------------------------------------------

export interface DraftRequest {
  accountId: string
  instruction: string
  /** Existing draft text to edit (rewrite modes). */
  draftText?: string
  /** Reply context. */
  inReplyToMessageId?: string
  mode: 'write' | 'reply' | 'rewrite' | 'shorten' | 'expand' | 'formal' | 'friendly' | 'fix' | 'translate'
  language?: string
  signatureName?: string
}

export async function draftEmail(k: Kernel, req: DraftRequest, onDelta?: (d: StreamDelta) => void): Promise<string> {
  const acct = k.accounts.get(req.accountId)
  const identity = k.identities.defaultFor(req.accountId)
  const who = identity ? `${identity.name} <${identity.email}>` : (acct?.email ?? 'the user')
  let context = ''
  const messageIds: string[] = []
  if (req.inReplyToMessageId) {
    const d = await k.mail.get(req.inReplyToMessageId)
    messageIds.push(d.id)
    const thread = d.threadId ? k.mail.thread(d.threadId).slice(-6) : []
    const parts: string[] = []
    for (const t of thread) {
      const td = t.id === d.id ? d : await k.mail.get(t.id)
      parts.push(renderMessage(td, 3000))
    }
    context = `\n\nThread being replied to (oldest first):\n${parts.join('\n\n---\n\n') || renderMessage(d)}`
  }
  const modeInstr: Record<DraftRequest['mode'], string> = {
    write: `Write an email that does the following: ${req.instruction}`,
    reply: `Write a reply on behalf of ${who}. ${req.instruction || 'Respond appropriately to the latest message.'}`,
    rewrite: `Rewrite this draft: ${req.instruction || 'improve clarity and flow'}`,
    shorten: 'Make this draft about half as long while keeping every key point.',
    expand: 'Expand this draft with a little more detail and warmth, staying concise.',
    formal: 'Make this draft more formal and professional.',
    friendly: 'Make this draft warmer and more conversational.',
    fix: 'Fix spelling, grammar and punctuation only; keep the wording otherwise.',
    translate: `Translate this draft into ${req.language ?? 'English'}.`
  }
  const isEdit = !['write', 'reply'].includes(req.mode)
  const system = req.mode === 'translate' ? P.TRANSLATE_SYSTEM : isEdit ? P.REWRITE_SYSTEM : P.DRAFT_SYSTEM
  const user = `${modeInstr[req.mode]}${req.draftText ? `\n\nDraft:\n"""\n${req.draftText}\n"""` : ''}${context}\n\nThe sender is ${who}.`
  const r = await k.ai.chat('drafting', { system, messages: [{ role: 'user', content: user }], maxTokens: 1500, accountIds: [req.accountId], messageIds }, onDelta)
  return r.text.trim()
}

// ---- smart replies -------------------------------------------------------------

export const SmartRepliesSchema = z.object({ replies: z.array(z.string()).min(1).max(3) })

export async function smartReplies(k: Kernel, messageId: string): Promise<string[]> {
  const d = await k.mail.get(messageId)
  const r = await k.ai.chat('summarize', {
    system: P.SMART_REPLY_SYSTEM,
    messages: [{ role: 'user', content: `${renderMessage(d, 2500)}\n\nReturn {"replies":["...","...","..."]}.` }],
    outputSchema: SmartRepliesSchema,
    maxTokens: 200,
    fast: true,
    accountIds: [d.accountId],
    messageIds: [d.id]
  })
  return (r.parsed as z.output<typeof SmartRepliesSchema> | undefined)?.replies ?? []
}

// ---- extraction ------------------------------------------------------------------

export const ExtractSchema = z.object({
  events: z.array(z.object({ title: z.string(), start: z.string(), end: z.string().nullable().default(null), location: z.string().nullable().default(null), allDay: z.boolean().default(false) })).default([]),
  tasks: z.array(z.object({ text: z.string(), due: z.string().nullable().default(null) })).default([]),
  tracking: z.array(z.object({ carrier: z.string().nullable().default(null), number: z.string(), url: z.string().nullable().default(null) })).default([]),
  amounts: z.array(z.object({ label: z.string(), amount: z.number(), currency: z.string(), due: z.string().nullable().default(null) })).default([]),
  contacts: z.array(z.object({ name: z.string(), email: z.string().nullable().default(null), phone: z.string().nullable().default(null) })).default([]),
  links: z.array(z.object({ label: z.string(), url: z.string() })).max(5).default([])
})
export type ExtractResult = z.output<typeof ExtractSchema>

export async function extractFromMessage(k: Kernel, messageId: string): Promise<ExtractResult> {
  const d = await k.mail.get(messageId)
  const r = await k.ai.chat('extract', {
    system: P.EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: `${renderMessage(d, 8000)}\n\nSchema: {events:[{title,start,end,location,allDay}], tasks:[{text,due}], tracking:[{carrier,number,url}], amounts:[{label,amount,currency,due}], contacts:[{name,email,phone}], links:[{label,url}]}` }],
    outputSchema: ExtractSchema,
    maxTokens: 1200,
    fast: true,
    accountIds: [d.accountId],
    messageIds: [d.id]
  })
  const parsed = (r.parsed as ExtractResult | undefined) ?? ExtractSchema.parse({})
  k.store.setAiExtract(messageId, parsed)
  return parsed
}

/** Build an .ics file for an extracted event. */
export function eventToIcs(e: ExtractResult['events'][number], uidSeed: string): string {
  const fmt = (iso: string, allDay: boolean) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso.replace(/[-:]/g, '')
    return allDay ? d.toISOString().slice(0, 10).replace(/-/g, '') : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  }
  const start = fmt(e.start, e.allDay)
  const end = fmt(e.end ?? e.start, e.allDay)
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mail City//EN',
    'BEGIN:VEVENT',
    `UID:${uidSeed}@mail-city`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    e.allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
    e.allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
}

// ---- natural-language rules -----------------------------------------------------------

const NlRuleSchema = z.object({
  name: z.string(),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(z.object({ field: z.enum(['from', 'to', 'cc', 'anyRecipient', 'subject', 'body', 'listId', 'hasAttachment', 'aiCategory']), op: z.enum(['contains', 'notContains', 'equals', 'startsWith', 'endsWith', 'regex', 'isTrue', 'isFalse']), value: z.string().default('') })).min(1),
  actions: z.array(z.object({ type: z.enum(['move', 'archive', 'markRead', 'flag', 'junk', 'delete', 'mute', 'setCategory']), folderId: z.string().nullable().default(null), category: z.string().nullable().default(null) })).min(1),
  explanation: z.string().default('')
})

export async function ruleFromText(k: Kernel, text: string, accountId?: string): Promise<{ rule: RuleInputParsed; explanation: string }> {
  const folders = k.store
    .listFolders(accountId)
    .map((f) => `${f.id}\t${k.accounts.get(f.accountId)?.displayName ?? ''} / ${f.path}${f.specialUse ? ` (${f.specialUse})` : ''}`)
    .join('\n')
  const r = await k.ai.chat('extract', {
    system: P.NL_RULE_SYSTEM,
    messages: [{ role: 'user', content: `Instruction: ${text}\n\nFolders (id<TAB>name):\n${folders}\n\nReturn {name, match, conditions:[{field,op,value}], actions:[{type, folderId, category}], explanation}.` }],
    outputSchema: NlRuleSchema,
    maxTokens: 600,
    accountIds: accountId ? [accountId] : []
  })
  const p = r.parsed as z.output<typeof NlRuleSchema> | undefined
  if (!p) throw new Error('Could not understand that instruction. Try e.g. "move newsletters from Substack to Reading".')
  const actions = p.actions
    .map((a) => (a.type === 'move' ? (a.folderId ? { type: 'move' as const, folderId: a.folderId } : null) : a.type === 'setCategory' ? { type: 'setCategory' as const, category: a.category ?? 'other' } : { type: a.type }))
    .filter((a): a is NonNullable<typeof a> => !!a)
  const rule = RuleInputSchema.parse({ name: p.name, conditions: { match: p.match, items: p.conditions }, actions, accountIds: accountId ? [accountId] : [] })
  return { rule, explanation: p.explanation }
}

// ---- phishing ----------------------------------------------------------------------------

export const PhishingSchema = z.object({ risk: z.enum(['low', 'medium', 'high']), reasons: z.array(z.string()).max(5), advice: z.string().default('') })

export async function explainPhishing(k: Kernel, messageId: string): Promise<z.output<typeof PhishingSchema>> {
  const d = await k.mail.get(messageId)
  const links = [...(d.textHtml ?? '').matchAll(/href="(https?:[^"]+)"/gi)].map((m) => m[1]!).slice(0, 15)
  const hdr = d.headers ?? {}
  const auth = ['authentication-results', 'received-spf', 'dkim-signature', 'return-path', 'reply-to', 'list-unsubscribe'].map((h) => (hdr[h] ? `${h}: ${String(hdr[h]).slice(0, 300)}` : null)).filter(Boolean).join('\n')
  const heuristics = localPhishingHeuristics(d, links)
  const r = await k.ai.chat('extract', {
    system: P.PHISHING_SYSTEM,
    messages: [{ role: 'user', content: `${renderMessage(d, 3000)}\n\nLinks:\n${links.join('\n') || '(none)'}\n\nHeaders:\n${auth || '(none)'}\n\nAutomated checks: ${heuristics.join('; ') || 'none flagged'}\n\nReturn {risk, reasons, advice}.` }],
    outputSchema: PhishingSchema,
    maxTokens: 400,
    fast: true,
    accountIds: [d.accountId],
    messageIds: [d.id]
  })
  return (r.parsed as z.output<typeof PhishingSchema> | undefined) ?? { risk: heuristics.length >= 2 ? 'medium' : 'low', reasons: heuristics, advice: '' }
}

export function localPhishingHeuristics(d: MessageDetail, links: string[]): string[] {
  const out: string[] = []
  const fromDomain = d.from.address.split('@')[1] ?? ''
  if (d.replyTo.length && d.replyTo.some((r) => r.address.split('@')[1] !== fromDomain)) out.push('Reply-To goes to a different domain than the sender')
  const brand = d.from.name.toLowerCase().match(/paypal|microsoft|apple|amazon|google|bank|dhl|ups|fedex|netflix|docusign/)?.[0]
  if (brand && !fromDomain.includes(brand)) out.push(`Display name mentions ${brand} but the address is @${fromDomain}`)
  const linkDomains = new Set(links.map((l) => { try { return new URL(l).hostname } catch { return '' } }).filter(Boolean))
  if (links.some((l) => /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(l))) out.push('Links point at raw IP addresses')
  if (linkDomains.size > 6) out.push('Many different link domains')
  const text = (d.textPlain ?? '').toLowerCase()
  if (/verify your account|suspended|unusual activity|confirm your password|urgent action|within 24 hours/.test(text)) out.push('Urgency / credential language')
  const auth = String(d.headers?.['authentication-results'] ?? '').toLowerCase()
  if (auth.includes('spf=fail') || auth.includes('dkim=fail') || auth.includes('dmarc=fail')) out.push('Email authentication (SPF/DKIM/DMARC) failed')
  return out
}

// ---- unsubscribe --------------------------------------------------------------------------

export interface UnsubscribeOption {
  kind: 'one-click' | 'mailto' | 'link'
  url: string
  /** Address for mailto variants. */
  to?: string
  subject?: string
}

export function unsubscribeOptions(d: MessageDetail): UnsubscribeOption[] {
  const out: UnsubscribeOption[] = []
  const header = d.listUnsubscribe ?? ''
  const post = String(d.headers?.['list-unsubscribe-post'] ?? '')
  for (const m of header.matchAll(/<([^>]+)>/g)) {
    const url = m[1]!.trim()
    if (url.startsWith('mailto:')) {
      const u = new URL(url)
      out.push({ kind: 'mailto', url, to: u.pathname, subject: u.searchParams.get('subject') ?? 'unsubscribe' })
    } else if (/^https?:/i.test(url)) {
      out.push({ kind: /one-click/i.test(post) ? 'one-click' : 'link', url })
    }
  }
  if (!out.length && d.textHtml) {
    const m = d.textHtml.match(/href="(https?:[^"]*(unsubscribe|opt-?out|manage-?preferences)[^"]*)"/i)
    if (m?.[1]) out.push({ kind: 'link', url: m[1].replace(/&amp;/g, '&') })
  }
  return out
}

/** Perform RFC 8058 one-click unsubscribe (POST List-Unsubscribe=One-Click). */
export async function oneClickUnsubscribe(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click', redirect: 'follow' })
    return res.ok
  } catch {
    return false
  }
}
