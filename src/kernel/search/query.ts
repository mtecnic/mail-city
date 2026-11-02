/**
 * Search query language → FTS5 MATCH expression + structured filters.
 *
 *   invoice from:acme has:attachment is:unread after:2026-01-01 "exact phrase" in:Archive account:work
 */
export interface ParsedQuery {
  /** FTS5 MATCH expression, or null if the query has no text terms. */
  match: string | null
  from?: string[]
  to?: string[]
  subjectTerms?: string[]
  hasAttachment?: boolean
  unread?: boolean
  flagged?: boolean
  folderName?: string
  account?: string
  before?: string // ISO date (exclusive)
  after?: string // ISO date (inclusive)
  larger?: number
  smaller?: number
}

const TOKEN = /"([^"]*)"|(\w+):("([^"]*)"|(\S+))|(\S+)/g

function escapeFts(term: string): string {
  // FTS5: double quotes inside a string are doubled; wrap in quotes to neutralize operators.
  return `"${term.replace(/"/g, '""')}"`
}

function prefix(term: string): string {
  const t = term.replace(/[*"]/g, '')
  return t.length ? `${escapeFts(t)}*` : ''
}

function toSize(v: string): number | undefined {
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(k|kb|m|mb|g|gb)?$/i)
  if (!m) return undefined
  const n = Number(m[1])
  const unit = (m[2] ?? '').toLowerCase()
  return Math.round(n * (unit.startsWith('g') ? 1e9 : unit.startsWith('m') ? 1e6 : unit.startsWith('k') ? 1e3 : 1))
}

function toDate(v: string, endOfDay = false): string | undefined {
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  let d: Date
  if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0)
  else {
    const rel = v.match(/^(\d+)([dwmy])$/)
    if (!rel) return undefined
    const n = Number(rel[1])
    d = new Date()
    if (rel[2] === 'd') d.setDate(d.getDate() - n)
    if (rel[2] === 'w') d.setDate(d.getDate() - 7 * n)
    if (rel[2] === 'm') d.setMonth(d.getMonth() - n)
    if (rel[2] === 'y') d.setFullYear(d.getFullYear() - n)
  }
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = { match: null }
  const parts: string[] = []
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(input))) {
    if (m[1] !== undefined) {
      if (m[1].trim()) parts.push(escapeFts(m[1].trim()))
      continue
    }
    if (m[2]) {
      const key = m[2].toLowerCase()
      const val = (m[4] ?? m[5] ?? '').trim()
      switch (key) {
        case 'from':
          ;(q.from ??= []).push(val)
          parts.push(`from_text:${prefix(val)}`)
          break
        case 'to':
        case 'cc':
          ;(q.to ??= []).push(val)
          parts.push(`to_text:${prefix(val)}`)
          break
        case 'subject':
          ;(q.subjectTerms ??= []).push(val)
          parts.push(`subject:${prefix(val)}`)
          break
        case 'has':
          if (val === 'attachment' || val === 'attachments') q.hasAttachment = true
          break
        case 'is':
          if (val === 'unread') q.unread = true
          else if (val === 'read') q.unread = false
          else if (val === 'starred' || val === 'flagged') q.flagged = true
          break
        case 'in':
        case 'folder':
          q.folderName = val
          break
        case 'account':
          q.account = val
          break
        case 'before':
          q.before = toDate(val)
          break
        case 'after':
        case 'since':
          q.after = toDate(val)
          break
        case 'larger':
          q.larger = toSize(val)
          break
        case 'smaller':
          q.smaller = toSize(val)
          break
        default:
          parts.push(prefix(`${key}:${val}`))
      }
      continue
    }
    if (m[6]) {
      const p = prefix(m[6])
      if (p) parts.push(p)
    }
  }
  const filtered = parts.filter(Boolean)
  q.match = filtered.length ? filtered.join(' AND ') : null
  return q
}
