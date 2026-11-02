import { asc, eq } from 'drizzle-orm'
import type { DB } from '../db'
import { rules, type MessageRow } from '../db/schema'
import type { MessageStore } from '../mail/MessageStore'
import type { MessageService } from '../mail/MessageService'
import { RuleInputSchema, RuleSchema, type Rule, type RuleCondition, type RuleInput } from '@shared/schemas/rules'
import { newId } from '../utils/ids'
import { createLogger } from '../utils/logger'
import { TypedEmitter } from '../utils/emitter'

export interface RuleOutcome {
  messageId: string
  rulesApplied: string[]
  muted: boolean
}

/**
 * Evaluates user rules against messages. Runs automatically on new mail (not on
 * the initial import) and on demand ("apply to folder"). Actions go through
 * MessageService so they're queued for the server like any user action.
 */
export class RulesEngine extends TypedEmitter<{ changed: []; applied: [RuleOutcome[]] }> {
  private readonly log = createLogger('rules')
  private forwardHandler: ((message: MessageRow, to: string) => Promise<void>) | null = null

  constructor(
    private readonly db: DB,
    private readonly store: MessageStore,
    private readonly mail: MessageService
  ) {
    super()
  }

  /** Forwarding needs the compose stack; injected after construction. */
  setForwardHandler(h: (message: MessageRow, to: string) => Promise<void>): void {
    this.forwardHandler = h
  }

  list(): Rule[] {
    return this.db
      .select()
      .from(rules)
      .orderBy(asc(rules.sortOrder))
      .all()
      .map((r) => RuleSchema.parse({ ...r, conditions: r.conditions, actions: r.actions }))
  }

  save(input: RuleInput): Rule {
    const d = RuleInputSchema.parse(input)
    const id = d.id ?? newId('rule')
    const existing = this.db.select().from(rules).where(eq(rules.id, id)).get()
    const row = {
      id,
      name: d.name,
      enabled: d.enabled ?? existing?.enabled ?? true,
      sortOrder: d.sortOrder ?? existing?.sortOrder ?? this.list().length,
      accountIds: d.accountIds ?? existing?.accountIds ?? [],
      conditions: d.conditions,
      actions: d.actions,
      stopProcessing: d.stopProcessing ?? existing?.stopProcessing ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString()
    }
    this.db
      .insert(rules)
      .values(row)
      .onConflictDoUpdate({ target: rules.id, set: { ...row, createdAt: undefined } })
      .run()
    this.emit('changed')
    return this.list().find((r) => r.id === id)!
  }

  remove(id: string): void {
    this.db.delete(rules).where(eq(rules.id, id)).run()
    this.emit('changed')
  }

  reorder(ids: string[]): void {
    ids.forEach((id, i) => this.db.update(rules).set({ sortOrder: i }).where(eq(rules.id, id)).run())
    this.emit('changed')
  }

  /** Apply all enabled rules to the given messages. */
  async run(messageIds: string[], opts: { includeDisabled?: boolean; onlyRuleId?: string } = {}): Promise<RuleOutcome[]> {
    const all = this.list().filter((r) => (opts.includeDisabled || r.enabled) && (!opts.onlyRuleId || r.id === opts.onlyRuleId))
    if (!all.length) return []
    const outcomes: RuleOutcome[] = []
    for (const id of messageIds) {
      const msg = this.store.getMessage(id)
      if (!msg) continue
      const outcome: RuleOutcome = { messageId: id, rulesApplied: [], muted: false }
      for (const rule of all) {
        if (rule.accountIds.length && !rule.accountIds.includes(msg.accountId)) continue
        if (!this.matches(rule, msg)) continue
        outcome.rulesApplied.push(rule.id)
        try {
          const muted = await this.apply(rule, msg)
          if (muted) outcome.muted = true
        } catch (e) {
          this.log.warn('rule action failed', { rule: rule.name, error: String(e) })
        }
        if (rule.stopProcessing) break
        if (!this.store.getMessage(id)) break // deleted by an action
      }
      if (outcome.rulesApplied.length) outcomes.push(outcome)
    }
    if (outcomes.length) this.emit('applied', outcomes)
    return outcomes
  }

  /** Apply rules to every cached message in a folder (or everywhere). */
  async applyToExisting(opts: { folderId?: string; ruleId?: string }): Promise<number> {
    const items = this.store.list({ folderId: opts.folderId, limit: 500 })
    const outcomes = await this.run(
      items.map((m) => m.id),
      { onlyRuleId: opts.ruleId }
    )
    return outcomes.length
  }

  matches(rule: Rule, msg: MessageRow): boolean {
    const results = rule.conditions.items.map((c) => this.test(c, msg))
    if (!results.length) return false
    return rule.conditions.match === 'all' ? results.every(Boolean) : results.some(Boolean)
  }

  private test(c: RuleCondition, msg: MessageRow): boolean {
    const value = c.value.toLowerCase()
    const strVal = (): string => {
      switch (c.field) {
        case 'from':
          return `${msg.fromName} <${msg.fromAddr}>`.toLowerCase()
        case 'to':
          return msg.toList.map((a) => `${a.name} <${a.address}>`).join(', ').toLowerCase()
        case 'cc':
          return msg.ccList.map((a) => `${a.name} <${a.address}>`).join(', ').toLowerCase()
        case 'anyRecipient':
          return [...msg.toList, ...msg.ccList, ...msg.bccList].map((a) => `${a.name} <${a.address}>`).join(', ').toLowerCase()
        case 'subject':
          return msg.subject.toLowerCase()
        case 'body':
          return (this.store.getBody(msg.id)?.textPlain ?? msg.snippet).toLowerCase()
        case 'listId':
          return (msg.listId ?? '').toLowerCase()
        case 'aiCategory':
          return (msg.aiCategory ?? '').toLowerCase()
        case 'anyHeader':
          return JSON.stringify(this.store.getBody(msg.id)?.headers ?? {}).toLowerCase()
        default:
          return ''
      }
    }
    if (c.field === 'hasAttachment') return c.op === 'isFalse' ? !msg.hasAttachments : msg.hasAttachments
    if (c.field === 'size') {
      const n = Number(c.value)
      return c.op === 'lt' ? msg.sizeBytes < n : msg.sizeBytes > n
    }
    const s = strVal()
    switch (c.op) {
      case 'contains':
        return s.includes(value)
      case 'notContains':
        return !s.includes(value)
      case 'equals':
        return s === value || s.includes(`<${value}>`)
      case 'startsWith':
        return s.startsWith(value)
      case 'endsWith':
        return s.endsWith(value) || s.endsWith(`${value}>`)
      case 'regex':
        try {
          return new RegExp(c.value, 'i').test(s)
        } catch {
          return false
        }
      case 'isTrue':
        return s.length > 0
      case 'isFalse':
        return s.length === 0
      default:
        return false
    }
  }

  private async apply(rule: Rule, msg: MessageRow): Promise<boolean> {
    let muted = false
    for (const a of rule.actions) {
      switch (a.type) {
        case 'move':
          this.mail.move([msg.id], a.folderId)
          break
        case 'archive':
          this.mail.archive([msg.id])
          break
        case 'delete':
          this.mail.delete([msg.id])
          break
        case 'junk':
          this.mail.markJunk([msg.id], true)
          break
        case 'markRead':
          this.mail.markRead([msg.id], true)
          break
        case 'flag':
          this.mail.flag([msg.id], true)
          break
        case 'mute':
          muted = true
          break
        case 'setCategory':
          this.store.setAiCategory(msg.id, a.category)
          break
        case 'forward':
          if (this.forwardHandler) await this.forwardHandler(msg, a.to)
          break
      }
    }
    return muted
  }
}
