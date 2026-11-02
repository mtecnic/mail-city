/**
 * Thread assignment. Gmail gives us X-GM-THRID; for everyone else we follow
 * References / In-Reply-To and fall back to the normalized subject within a
 * short time window (a simplified JWZ).
 */
export function normalizeSubject(subject: string): string {
  let s = subject.trim()
  // strip repeated Re:/Fwd:/AW:/SV: etc. prefixes and bracketed list tags
  for (;;) {
    const next = s
      .replace(/^\s*((re|fw|fwd|aw|wg|sv|vs|tr|r)\s*(\[\d+\])?\s*:\s*)+/i, '')
      .replace(/^\s*\[[^\]]{1,40}\]\s*/, '')
      .trim()
    if (next === s) break
    s = next
  }
  return s.toLowerCase().replace(/\s+/g, ' ')
}

export interface ThreadLookup {
  /** Find the threadId of an existing message in this account by Message-ID. */
  byMessageId(messageId: string): string | undefined
  /** Find a recent thread by normalized subject (for replies without headers). */
  bySubject(subjectNormalized: string, newerThan: Date): string | undefined
}

export function assignThread(
  msg: { id: string; messageId: string | null; inReplyTo: string | null; references: string[]; subject: string; gmThreadId: string | null; date: Date },
  lookup: ThreadLookup
): string {
  if (msg.gmThreadId) return `gm:${msg.gmThreadId}`
  const candidates = [...msg.references].reverse()
  if (msg.inReplyTo) candidates.unshift(msg.inReplyTo)
  for (const ref of candidates) {
    const hit = lookup.byMessageId(ref)
    if (hit) return hit
  }
  const norm = normalizeSubject(msg.subject)
  if (norm && /^(re|fw|fwd|aw|wg|sv)\s*:/i.test(msg.subject.trim())) {
    const hit = lookup.bySubject(norm, new Date(msg.date.getTime() - 30 * 24 * 3600 * 1000))
    if (hit) return hit
  }
  return `t:${msg.id}`
}
