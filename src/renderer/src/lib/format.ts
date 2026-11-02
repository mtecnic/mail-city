const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function formatListDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const diff = now.getTime() - d.getTime()
  if (diff < 6 * 86_400_000 && diff > 0) return d.toLocaleDateString(undefined, { weekday: 'short' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}

export function formatFullDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function initials(name: string, address: string): string {
  const src = name || address
  const parts = src.replace(/[<>"]/g, '').trim().split(/[\s._-]+/).filter(Boolean)
  const s = parts.length >= 2 ? parts[0]![0]! + parts[1]![0]! : src.slice(0, 2)
  return s.toUpperCase()
}

export function avatarColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 45% 45%)`
}
