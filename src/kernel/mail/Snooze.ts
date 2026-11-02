import { and, isNotNull, lte } from 'drizzle-orm'
import type { DB } from '../db'
import { messages } from '../db/schema'
import type { MessageStore } from './MessageStore'
import { TypedEmitter } from '../utils/emitter'

/** Local snooze: hides messages from lists until `snoozedUntil`, then resurfaces them unread. */
export class SnoozeService extends TypedEmitter<{ woke: [messageIds: string[]] }> {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly db: DB,
    private readonly store: MessageStore
  ) {
    super()
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.wake(), 30_000)
    this.wake()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snooze(ids: string[], until: Date): void {
    this.store.setSnoozed(ids, until.toISOString())
  }

  unsnooze(ids: string[]): void {
    this.store.setSnoozed(ids, null)
  }

  wake(): string[] {
    const now = new Date().toISOString()
    const due = this.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(isNotNull(messages.snoozedUntil), lte(messages.snoozedUntil, now)))
      .all()
      .map((r) => r.id)
    if (!due.length) return []
    this.store.setSnoozed(due, null)
    this.store.setLocalFlags(due, { seen: false })
    this.emit('woke', due)
    return due
  }
}

/** Common snooze presets, computed in local time. */
export function snoozePreset(preset: 'laterToday' | 'tomorrow' | 'thisWeekend' | 'nextWeek', now = new Date()): Date {
  const d = new Date(now)
  switch (preset) {
    case 'laterToday':
      d.setHours(d.getHours() + 3, 0, 0, 0)
      return d
    case 'tomorrow':
      d.setDate(d.getDate() + 1)
      d.setHours(8, 0, 0, 0)
      return d
    case 'thisWeekend': {
      const day = d.getDay()
      d.setDate(d.getDate() + ((6 - day + 7) % 7 || 7))
      d.setHours(8, 0, 0, 0)
      return d
    }
    case 'nextWeek': {
      const day = d.getDay()
      d.setDate(d.getDate() + ((1 - day + 7) % 7 || 7))
      d.setHours(8, 0, 0, 0)
      return d
    }
  }
}
