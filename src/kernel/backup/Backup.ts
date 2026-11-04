/**
 * Backup & restore of the *setup*: accounts with their secrets, identities,
 * signatures, rules, contacts, settings and vault keys. The mail cache is left
 * out; a fresh sync rebuilds it. Secrets are decrypted here and re-encrypted
 * with the importing machine's keystore by the ordinary stores.
 */
import { eq, like } from 'drizzle-orm'
import type { Kernel } from '../index'
import { accounts, contacts, identities, settings as settingsTable } from '../db/schema'
import { BackupPayloadSchema, type BackupHeader, type BackupPayload, type ImportResult } from '@shared/schemas/backup'
import { AiSettingsSchema } from '@shared/schemas/ai'
import { McpSettingsSchema } from '@shared/schemas/mcp'
import { createLogger } from '../utils/logger'

const log = createLogger('backup')
/** Settings-table keys worth carrying to another machine. Window state and the like stay behind. */
const SETTINGS_KEYS = ['app', 'ai', 'mcp', 'oauthClients', 'savedSearches'] as const

export function exportBackup(k: Kernel, meta: { appVersion: string; platform: string }): { header: BackupHeader; payload: BackupPayload } {
  const payload: BackupPayload = {
    accounts: k.accounts.list().map((a) => {
      const row = k.accounts.get(a.id)!
      const secret = (kind: 'password' | 'refresh_token' | 'oauth_meta') => k.accounts.secrets.get(a.id, kind)?.value
      return {
        id: row.id,
        type: row.type,
        email: row.email,
        displayName: row.displayName,
        imap: { host: row.imapHost, port: row.imapPort, tls: row.imapTls },
        smtp: { host: row.smtpHost, port: row.smtpPort, tls: row.smtpTls },
        authType: row.authType,
        oauthProvider: row.oauthProvider,
        color: row.color,
        sortOrder: row.sortOrder,
        enabled: row.enabled,
        syncSettings: row.syncSettings,
        secrets: { password: secret('password'), refresh_token: secret('refresh_token'), oauth_meta: secret('oauth_meta') }
      }
    }),
    identities: k.identities.list(),
    signatures: k.identities.listSignatures(),
    rules: k.rules.list(),
    contacts: k.contacts.list().map((c) => ({ id: c.id, name: c.name, emails: c.emails, primaryEmail: c.primaryEmail, lastSeenAt: c.lastSeenAt, sendCount: c.sendCount, receiveCount: c.receiveCount, source: c.source, notes: c.notes })),
    settings: {},
    vault: {}
  }
  for (const key of SETTINGS_KEYS) {
    const row = k.db.select().from(settingsTable).where(eq(settingsTable.key, key)).get()
    if (row && row.value !== null) payload.settings[key] = row.value
  }
  const vaultRows = k.db.select({ key: settingsTable.key }).from(settingsTable).where(like(settingsTable.key, 'vault.%')).all()
  for (const { key } of vaultRows) {
    const name = key.slice('vault.'.length)
    const value = k.vault.get(name)
    if (value !== null) payload.vault[name] = value
  }
  const header: BackupHeader = {
    createdAt: new Date().toISOString(),
    appVersion: meta.appVersion,
    platform: meta.platform,
    counts: { accounts: payload.accounts.length, rules: payload.rules.length, contacts: payload.contacts.length, providers: Object.keys(payload.vault).filter((n) => n.startsWith('ai.')).length }
  }
  return { header, payload }
}

/**
 * Merge a backup into this installation. Accounts are matched by e-mail address;
 * ids from the file are kept when free so rules, identities and per-account
 * settings keep pointing at the right account, and remapped otherwise.
 */
export function importBackup(k: Kernel, raw: unknown): ImportResult {
  const p = BackupPayloadSchema.parse(raw)
  const result: ImportResult = { accounts: { created: 0, updated: 0 }, identities: 0, signatures: 0, rules: 0, contacts: 0, providers: 0, vaultEntries: 0 }
  const idMap = new Map<string, string>()
  const mapId = (id: string) => idMap.get(id) ?? id

  const existingByEmail = new Map(k.accounts.list().map((a) => [a.email.toLowerCase(), a.id]))
  const localIds = new Set(k.accounts.list().map((a) => a.id))
  const now = new Date().toISOString()

  k.db.transaction((tx) => {
    for (const a of p.accounts) {
      const email = a.email.toLowerCase()
      const existing = existingByEmail.get(email)
      const values = {
        type: a.type,
        email,
        displayName: a.displayName,
        imapHost: a.imap.host,
        imapPort: a.imap.port,
        imapTls: a.imap.tls,
        smtpHost: a.smtp.host,
        smtpPort: a.smtp.port,
        smtpTls: a.smtp.tls,
        authType: a.authType,
        oauthProvider: a.oauthProvider,
        color: a.color,
        sortOrder: a.sortOrder,
        enabled: a.enabled,
        syncSettings: a.syncSettings,
        lastError: null
      }
      if (existing) {
        idMap.set(a.id, existing)
        tx.update(accounts).set(values).where(eq(accounts.id, existing)).run()
        result.accounts.updated++
      } else {
        const id = localIds.has(a.id) ? `${a.id}_${Math.random().toString(36).slice(2, 8)}` : a.id
        idMap.set(a.id, id)
        tx.insert(accounts).values({ id, ...values, createdAt: now }).run()
        localIds.add(id)
        existingByEmail.set(email, id)
        result.accounts.created++
      }
    }
    for (const s of p.signatures) {
      k.identities.saveSignature(s)
      result.signatures++
    }
    for (const i of p.identities) {
      const accountId = mapId(i.accountId)
      if (!localIds.has(accountId)) continue
      const cur = tx.select().from(identities).where(eq(identities.accountId, accountId)).all()
      const match = cur.find((x) => x.email.toLowerCase() === i.email.toLowerCase())
      const values = { email: i.email.toLowerCase(), name: i.name, signatureId: i.signatureId, replyTo: i.replyTo, isDefault: i.isDefault }
      if (i.isDefault) tx.update(identities).set({ isDefault: false }).where(eq(identities.accountId, accountId)).run()
      if (match) tx.update(identities).set(values).where(eq(identities.id, match.id)).run()
      else tx.insert(identities).values({ id: cur.some((x) => x.id === i.id) || k.identities.get(i.id) ? `${i.id}_${Math.random().toString(36).slice(2, 8)}` : i.id, accountId, ...values }).run()
      result.identities++
    }
    for (const r of p.rules) {
      k.rules.save({ ...r, accountIds: r.accountIds.map(mapId).filter((id) => localIds.has(id)) })
      result.rules++
    }
    for (const c of p.contacts) {
      const cur = k.contacts.byEmail(c.primaryEmail)
      if (cur) {
        tx.update(contacts)
          .set({
            name: cur.name || c.name,
            emails: [...new Set([...cur.emails, ...c.emails])],
            notes: cur.notes ?? c.notes,
            source: cur.source === 'harvested' ? c.source : cur.source,
            sendCount: Math.max(cur.sendCount, c.sendCount),
            receiveCount: Math.max(cur.receiveCount, c.receiveCount),
            lastSeenAt: [cur.lastSeenAt, c.lastSeenAt].filter(Boolean).sort().at(-1) ?? null
          })
          .where(eq(contacts.id, cur.id))
          .run()
      } else {
        tx.insert(contacts).values({ ...c, id: k.contacts.get(c.id) ? `${c.id}_${Math.random().toString(36).slice(2, 8)}` : c.id }).onConflictDoNothing().run()
      }
      result.contacts++
    }
  })

  // Secrets go through the store so they are encrypted with this machine's keystore.
  for (const a of p.accounts) {
    const id = mapId(a.id)
    k.accounts.secrets.delete(id)
    if (a.secrets.password) k.accounts.secrets.set(id, 'password', a.secrets.password)
    if (a.secrets.refresh_token) k.accounts.secrets.set(id, 'refresh_token', a.secrets.refresh_token)
    if (a.secrets.oauth_meta) k.accounts.secrets.set(id, 'oauth_meta', a.secrets.oauth_meta)
  }

  // Settings: general settings deep-merge; the others replace, with account ids remapped.
  if (p.settings['app']) k.settings.set(p.settings['app'] as never)
  if (p.settings['ai']) {
    const ai = AiSettingsSchema.parse(p.settings['ai'])
    const perAccount: Record<string, 'local-only' | 'cloud-allowed'> = {}
    for (const [id, mode] of Object.entries(ai.privacy.perAccount)) if (localIds.has(mapId(id))) perAccount[mapId(id)] = mode
    k.settings.setValue('ai', { ...ai, privacy: { ...ai.privacy, perAccount } })
    result.providers = ai.providers.length
  }
  if (p.settings['mcp']) {
    const mcp = McpSettingsSchema.parse(p.settings['mcp'])
    // A new machine gets a fresh token and must opt into the HTTP endpoint again.
    k.settings.setValue('mcp', { ...mcp, httpEnabled: false, accountIds: mcp.accountIds.map(mapId).filter((id) => localIds.has(id)) })
  }
  if (p.settings['oauthClients']) k.settings.setValue('oauthClients', p.settings['oauthClients'])
  if (p.settings['savedSearches']) k.settings.setValue('savedSearches', p.settings['savedSearches'])
  for (const [name, value] of Object.entries(p.vault)) {
    if (name === 'mcp.token') continue
    k.vault.set(name, value)
    result.vaultEntries++
  }

  // Wake everything that caches settings or watches accounts.
  k.ai.set({})
  k.accounts.emit('changed')
  log.info('backup imported', result)
  return result
}
