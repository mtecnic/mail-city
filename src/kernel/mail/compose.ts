/**
 * MIME building and reply/forward quoting. Pure functions, no I/O except
 * reading attachment files when building the MIME.
 */
import MailComposer from 'nodemailer/lib/mail-composer'
import type { Address } from '../db/schema'
import type { DraftAttachment, ReplyMode } from '@shared/schemas/compose'
import type { MessageDetail } from './MessageService'
import { formatAddress } from './addresses'
import { htmlToText } from './text'

export interface ComposeInput {
  from: Address
  replyTo?: string | null
  to: Address[]
  cc: Address[]
  bcc: Address[]
  subject: string
  html: string
  text: string
  attachments: DraftAttachment[]
  inReplyTo?: string | null
  references?: string[]
  messageId?: string
  date?: Date
}

export interface BuiltMime {
  raw: Buffer
  messageId: string
  envelope: { from: string; to: string[] }
}

export async function buildMime(input: ComposeInput): Promise<BuiltMime> {
  const domain = input.from.address.split('@')[1] ?? 'mail-city.local'
  const messageId = input.messageId ?? `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domain}>`
  const composer = new MailComposer({
    from: formatAddress(input.from),
    replyTo: input.replyTo ?? undefined,
    to: input.to.map(formatAddress),
    cc: input.cc.map(formatAddress),
    bcc: input.bcc.map(formatAddress),
    subject: input.subject,
    text: input.text || htmlToText(input.html),
    html: input.html || undefined,
    messageId,
    date: input.date,
    inReplyTo: input.inReplyTo ?? undefined,
    references: input.references?.length ? input.references.join(' ') : undefined,
    attachments: input.attachments.map((a) => ({ path: a.path, filename: a.filename, contentType: a.mimeType, cid: a.cid, contentDisposition: a.cid ? 'inline' : 'attachment' })),
    headers: { 'X-Mailer': 'Mail City' }
  })
  const raw = await composer.compile().build()
  const rcpts = [...input.to, ...input.cc, ...input.bcc].map((a) => a.address).filter(Boolean)
  return { raw, messageId, envelope: { from: input.from.address, to: [...new Set(rcpts)] } }
}

// ---- quoting -----------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function replySubject(subject: string, mode: ReplyMode): string {
  const s = subject.trim()
  if (mode === 'forward') return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`
  return /^re:/i.test(s) ? s : `Re: ${s}`
}

/** Recipients for a reply, excluding our own addresses. */
export function replyRecipients(m: MessageDetail, mode: ReplyMode, ownAddresses: string[]): { to: Address[]; cc: Address[] } {
  if (mode === 'forward') return { to: [], cc: [] }
  const own = new Set(ownAddresses.map((a) => a.toLowerCase()))
  const primary = m.replyTo.length ? m.replyTo : [m.from]
  if (mode === 'reply') return { to: primary, cc: [] }
  const seen = new Set<string>()
  const dedupe = (list: Address[]) => list.filter((a) => a.address && !own.has(a.address) && !seen.has(a.address) && seen.add(a.address))
  const to = dedupe(primary)
  const cc = dedupe([...m.to, ...m.cc])
  // If we're the only recipient besides the sender, keep it a plain reply.
  return { to: to.length ? to : dedupe([m.from]), cc }
}

export function quoteMessage(m: MessageDetail, mode: ReplyMode): { html: string; text: string } {
  const date = new Date(m.date)
  const when = Number.isNaN(date.getTime()) ? m.date : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  const who = formatAddress(m.from)
  const bodyHtml = m.textHtml ?? (m.textPlain ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.textPlain)}</pre>` : '')
  const bodyText = m.textPlain ?? (m.textHtml ? htmlToText(m.textHtml) : '')

  if (mode === 'forward') {
    const hdr = [
      ['From', who],
      ['Date', when],
      ['Subject', m.subject],
      ['To', m.to.map(formatAddress).join(', ')],
      ...(m.cc.length ? [['Cc', m.cc.map(formatAddress).join(', ')]] : [])
    ]
    const html = `<br><br><div class="mc-quote">---------- Forwarded message ---------<br>${hdr.map(([k, v]) => `<b>${k}:</b> ${esc(v!)}`).join('<br>')}<br><br>${bodyHtml}</div>`
    const text = `\n\n---------- Forwarded message ---------\n${hdr.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${bodyText}`
    return { html, text }
  }
  const html = `<br><br><div class="mc-quote">On ${esc(when)}, ${esc(who)} wrote:<br><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${bodyHtml}</blockquote></div>`
  const text = `\n\nOn ${when}, ${who} wrote:\n${bodyText
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')}`
  return { html, text }
}

export function appendSignature(html: string, text: string, sig: { html: string; text: string } | undefined): { html: string; text: string } {
  if (!sig) return { html, text }
  return { html: `${html}<br><br><div class="mc-signature">-- <br>${sig.html}</div>`, text: `${text}\n\n-- \n${sig.text}` }
}
