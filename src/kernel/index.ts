/**
 * Mail kernel facade.
 *
 * Pure Node — no Electron imports. The main process, the MCP stdio entry point
 * and the test-suite all construct a Kernel the same way. Everything the UI or
 * an LLM can do goes through this object.
 */
import { openDb, type DbHandle } from './db'
import { SettingsStore } from './settings/SettingsStore'
import { createLogger } from './utils/logger'
import type { SecretCipher } from './accounts/SecretStore'
import { AccountStore } from './accounts/AccountStore'

export interface KernelOptions {
  /** Directory for the database, attachments, raw mail and caches. */
  dataDir: string
  /** ':memory:' overrides dataDir for the DB (tests). */
  dbPath?: string
  /** OS-backed encryption for secrets (Electron safeStorage in the app, a no-op cipher in tests). */
  cipher: SecretCipher
}

export class Kernel {
  readonly log = createLogger('kernel')
  readonly dbHandle: DbHandle
  readonly settings: SettingsStore
  readonly accounts: AccountStore

  constructor(readonly options: KernelOptions) {
    this.dbHandle = openDb({ path: options.dbPath ?? `${options.dataDir}/mail-city.sqlite` })
    this.settings = new SettingsStore(this.db)
    this.accounts = new AccountStore(this.db, options.cipher)
    this.log.info('kernel ready', { dataDir: options.dataDir, vec: this.dbHandle.hasVec })
  }

  get db() {
    return this.dbHandle.db
  }

  async shutdown(): Promise<void> {
    this.dbHandle.close()
  }
}

export type { SecretCipher } from './accounts/SecretStore'
