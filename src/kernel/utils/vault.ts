import type { SecretCipher } from '../accounts/SecretStore'
import type { SettingsStore } from '../settings/SettingsStore'
import { z } from 'zod'

/** Named secrets (API keys, tokens for the MCP server…) encrypted with the OS keystore and kept in the settings table. */
export class SecretVault {
  constructor(
    private readonly settings: SettingsStore,
    private readonly cipher: SecretCipher
  ) {}

  set(name: string, value: string): void {
    this.settings.setValue(`vault.${name}`, { c: this.cipher.encrypt(value) })
  }

  get(name: string): string | null {
    const v = this.settings.getValue(`vault.${name}`, z.object({ c: z.string() }).optional())
    if (!v) return null
    try {
      return this.cipher.decrypt(v.c)
    } catch {
      return null
    }
  }

  has(name: string): boolean {
    return this.get(name) !== null
  }

  delete(name: string): void {
    this.settings.setValue(`vault.${name}`, null)
  }
}
