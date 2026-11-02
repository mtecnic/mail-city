import type { Address } from '../db/schema'

export interface RawAddress {
  name?: string | undefined
  address?: string | undefined
}

export function toAddresses(list: RawAddress[] | undefined | null): Address[] {
  if (!list) return []
  return list
    .filter((a) => a && (a.address || a.name))
    .map((a) => ({ name: (a.name ?? '').trim(), address: (a.address ?? '').trim().toLowerCase() }))
}

export function formatAddress(a: Address): string {
  if (!a.name) return a.address
  const needsQuote = /[",<>@]/.test(a.name)
  return `${needsQuote ? `"${a.name.replace(/"/g, '\\"')}"` : a.name} <${a.address}>`
}

export function displayName(a: Address | undefined): string {
  if (!a) return ''
  return a.name || a.address.split('@')[0] || a.address
}

/** Very small RFC 5322-ish parser for user-typed address lists: "A <a@x>, b@y". */
export function parseAddressList(input: string): Address[] {
  const out: Address[] = []
  const re = /(?:"([^"]*)"|([^<,]+?))?\s*<([^>]+)>|([^\s,<>]+@[^\s,<>]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m[3]) out.push({ name: (m[1] ?? m[2] ?? '').trim(), address: m[3].trim().toLowerCase() })
    else if (m[4]) out.push({ name: '', address: m[4].trim().toLowerCase() })
  }
  return out
}
