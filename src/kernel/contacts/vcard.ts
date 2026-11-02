export interface VCardContact {
  name: string
  emails: string[]
  notes?: string
}

function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '')
}

function unescapeValue(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/** Minimal vCard 3.0/4.0 reader: FN, N, EMAIL, NOTE. */
export function parseVCards(text: string): VCardContact[] {
  const out: VCardContact[] = []
  for (const block of unfold(text).split(/BEGIN:VCARD/i).slice(1)) {
    let fn = ''
    let n = ''
    const emails: string[] = []
    let notes: string | undefined
    for (const line of block.split(/\r?\n/)) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const key = line.slice(0, i).split(';')[0]!.toUpperCase()
      const val = unescapeValue(line.slice(i + 1).trim())
      if (key === 'FN') fn = val
      else if (key === 'N') {
        const [last = '', first = ''] = val.split(';')
        n = `${first} ${last}`.trim()
      } else if (key === 'EMAIL') {
        const e = val.toLowerCase()
        if (e.includes('@') && !emails.includes(e)) emails.push(e)
      } else if (key === 'NOTE') notes = val
    }
    if (emails.length) out.push({ name: fn || n, emails, notes })
  }
  return out
}

function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

export function toVCards(contacts: VCardContact[]): string {
  return contacts
    .map((c) => {
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escapeValue(c.name || c.emails[0] || '')}`]
      const parts = (c.name || '').split(' ')
      lines.push(`N:${escapeValue(parts.slice(1).join(' '))};${escapeValue(parts[0] ?? '')};;;`)
      for (const e of c.emails) lines.push(`EMAIL;TYPE=INTERNET:${e}`)
      if (c.notes) lines.push(`NOTE:${escapeValue(c.notes)}`)
      lines.push('END:VCARD')
      return lines.join('\r\n')
    })
    .join('\r\n')
}
