import type { SafeStorage } from 'electron'
import type { SecretCipher } from '@kernel/accounts/SecretStore'

/** SecretCipher backed by Electron safeStorage (DPAPI on Windows, Keychain on macOS, libsecret on Linux). */
export function electronCipher(safeStorage: SafeStorage): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available')
      return safeStorage.encryptString(plain).toString('base64')
    },
    decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  }
}
