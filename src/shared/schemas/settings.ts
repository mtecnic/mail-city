import { z } from 'zod'

export const ThemeSchema = z.enum(['system', 'light', 'dark'])

export const AppSettingsSchema = z.object({
  theme: ThemeSchema.default('system'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  minimizeToTray: z.boolean().default(true),
  launchAtLogin: z.boolean().default(false),
  notifications: z
    .object({
      enabled: z.boolean().default(true),
      sound: z.boolean().default(false)
    })
    .default({ enabled: true, sound: false }),
  privacy: z
    .object({
      loadRemoteImages: z.enum(['never', 'contacts', 'always']).default('never')
    })
    .default({ loadRemoteImages: 'never' }),
  sync: z
    .object({
      initialWindowDays: z.number().int().min(7).max(3650).default(90),
      pollIntervalMinutes: z.number().int().min(1).max(60).default(5)
    })
    .default({ initialWindowDays: 90, pollIntervalMinutes: 5 }),
  compose: z
    .object({
      undoSendSeconds: z.number().int().min(0).max(60).default(10)
    })
    .default({ undoSendSeconds: 10 })
})

export type AppSettings = z.output<typeof AppSettingsSchema>
/** Deep-partial patch shape (every field has a default, so input is fully optional). */
export type AppSettingsPatch = z.input<typeof AppSettingsSchema>
export const defaultSettings = (): AppSettings => AppSettingsSchema.parse({})
