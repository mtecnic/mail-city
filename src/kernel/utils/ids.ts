import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Short, URL-safe, time-sortable id: 8 chars of base36 time + 10 random chars. */
export function newId(prefix?: string): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const bytes = randomBytes(10)
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length]
  return prefix ? `${prefix}_${time}${rand}` : `${time}${rand}`
}
