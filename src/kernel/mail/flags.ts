import type { MessageFlags } from '../db/schema'

export function flagsFromSet(set: Set<string> | Iterable<string> | undefined): MessageFlags {
  const s = new Set([...(set ?? [])].map((f) => f.toLowerCase()))
  return {
    seen: s.has('\\seen'),
    flagged: s.has('\\flagged'),
    answered: s.has('\\answered'),
    draft: s.has('\\draft'),
    deleted: s.has('\\deleted'),
    forwarded: s.has('$forwarded') || s.has('\\forwarded')
  }
}

export const IMAP_FLAG: Record<keyof MessageFlags, string> = {
  seen: '\\Seen',
  flagged: '\\Flagged',
  answered: '\\Answered',
  draft: '\\Draft',
  deleted: '\\Deleted',
  forwarded: '$Forwarded'
}

export function applyFlagPatch(flags: MessageFlags, patch: Partial<MessageFlags>): MessageFlags {
  return { ...flags, ...patch }
}
