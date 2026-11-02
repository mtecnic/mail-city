/**
 * Background triage: classify new inbox mail (category, priority) with the
 * routed triage model, batched and rate-limited so a small local model keeps up.
 */
import type { Kernel } from '../index'
import { triageMessages } from './features'
import { createLogger } from '../utils/logger'

const log = createLogger('ai:triage')

export class TriageRunner {
  private queue = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly k: Kernel) {}

  start(): void {
    this.k.sync.on('newMessages', (_a, folderId, ids) => {
      const f = this.k.store.getFolder(folderId)
      if (f?.specialUse !== 'inbox') return
      if (!this.k.ai.get().enabled || !this.k.ai.get().autoTriage || !this.k.ai.routeFor('triage')) return
      for (const id of ids) this.queue.add(id)
      this.schedule()
    })
  }

  private schedule() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, 4000)
  }

  async flush(): Promise<number> {
    if (this.running || !this.queue.size) return 0
    this.running = true
    const ids = [...this.queue].slice(0, 40)
    ids.forEach((id) => this.queue.delete(id))
    try {
      const r = await triageMessages(this.k, ids)
      if (r.length) this.k.events.emit('triaged', r.map((x) => x.id))
      return r.length
    } catch (e) {
      log.warn('triage failed', { error: String(e) })
      return 0
    } finally {
      this.running = false
      if (this.queue.size) this.schedule()
    }
  }

  /** Triage the untriaged inbox backlog (on demand from Settings / Focused view). */
  async backlog(limit = 200): Promise<number> {
    const rows = this.k.store.list({ specialUse: 'inbox', limit }).filter((m) => !m.aiCategory)
    for (const m of rows) this.queue.add(m.id)
    return this.flush()
  }
}
