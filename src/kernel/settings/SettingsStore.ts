import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { DB } from '../db'
import { settings } from '../db/schema'
import { AppSettingsSchema, type AppSettings, type AppSettingsPatch } from '@shared/schemas/settings'
import { TypedEmitter } from '../utils/emitter'

const APP_KEY = 'app'

export class SettingsStore extends TypedEmitter<{ changed: [AppSettings] }> {
  private cache: AppSettings | null = null

  constructor(private readonly db: DB) {
    super()
  }

  get(): AppSettings {
    if (this.cache) return this.cache
    const row = this.db.select().from(settings).where(eq(settings.key, APP_KEY)).get()
    const parsed = AppSettingsSchema.safeParse(row?.value ?? {})
    this.cache = parsed.success ? parsed.data : AppSettingsSchema.parse({})
    return this.cache
  }

  set(patch: AppSettingsPatch): AppSettings {
    const next = AppSettingsSchema.parse(deepMerge(this.get() as Record<string, any>, patch as Record<string, any>))
    this.db
      .insert(settings)
      .values({ key: APP_KEY, value: next, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date().toISOString() } })
      .run()
    this.cache = next
    this.emit('changed', next)
    return next
  }

  /** Generic typed key/value access for other subsystems (AI config, window state, ...). */
  getValue<T extends z.ZodTypeAny>(key: string, schema: T): z.output<T> {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get()
    const parsed = schema.safeParse(row?.value)
    return parsed.success ? parsed.data : schema.parse(undefined)
  }

  setValue(key: string, value: unknown): void {
    this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString() } })
      .run()
  }
}

function deepMerge<T extends Record<string, any>>(base: T, patch: Record<string, any>): T {
  const out: Record<string, any> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v)
    } else {
      out[k] = v
    }
  }
  return out as T
}
