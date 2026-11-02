import { OAuthClientConfigSchema, type OAuthClientConfig } from '@shared/schemas/oauth'
import type { SettingsStore } from '../settings/SettingsStore'

const KEY = 'oauthClients'

export interface OAuthEnvDefaults {
  googleClientId?: string
  googleClientSecret?: string
  microsoftClientId?: string
}

/**
 * Effective OAuth client config = user-entered values (settings) falling back to
 * build-time defaults. Users of a personal build paste their own client IDs.
 */
export class OAuthConfig {
  constructor(
    private readonly settings: SettingsStore,
    private readonly env: OAuthEnvDefaults
  ) {}

  /** What the user has typed (never includes env defaults so the UI shows blanks correctly). */
  getUserConfig(): OAuthClientConfig {
    return this.settings.getValue(KEY, OAuthClientConfigSchema)
  }

  setUserConfig(cfg: OAuthClientConfig): void {
    this.settings.setValue(KEY, OAuthClientConfigSchema.parse(cfg))
  }

  /** Merged config actually used for sign-in. */
  effective(): OAuthClientConfig {
    const u = this.getUserConfig()
    return {
      google: {
        clientId: u.google.clientId || this.env.googleClientId || '',
        clientSecret: u.google.clientSecret || this.env.googleClientSecret || ''
      },
      microsoft: {
        clientId: u.microsoft.clientId || this.env.microsoftClientId || '',
        tenant: u.microsoft.tenant || 'common'
      }
    }
  }

  hasGoogle(): boolean {
    return !!this.effective().google.clientId
  }

  hasMicrosoft(): boolean {
    return !!this.effective().microsoft.clientId
  }
}
