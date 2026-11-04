/**
 * Passphrase encryption for backup files: scrypt → AES-256-GCM, with the
 * unencrypted header bound in as additional authenticated data. Pure Node
 * crypto, so a file made on Windows restores on any OS.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { z } from 'zod'
import { BACKUP_FORMAT, BACKUP_VERSION, BackupHeaderSchema, type BackupHeader } from '@shared/schemas/backup'

export const MIN_PASSPHRASE = 8
const KDF = { N: 2 ** 15, r: 8, p: 1, keyLen: 32 }

const FileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int(),
  header: BackupHeaderSchema,
  kdf: z.object({ name: z.literal('scrypt'), salt: z.string(), N: z.number().int(), r: z.number().int(), p: z.number().int() }),
  iv: z.string(),
  tag: z.string(),
  data: z.string()
})

export class BackupFileError extends Error {
  constructor(
    message: string,
    readonly code: 'not_a_backup' | 'newer_version' | 'wrong_passphrase' | 'weak_passphrase'
  ) {
    super(message)
    this.name = 'BackupFileError'
  }
}

function aad(header: BackupHeader, version: number): Buffer {
  return Buffer.from(JSON.stringify({ format: BACKUP_FORMAT, version, header }), 'utf8')
}

export function encryptBackup(header: BackupHeader, payload: unknown, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE) throw new BackupFileError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters`, 'weak_passphrase')
  const salt = randomBytes(16)
  const key = scryptSync(passphrase.normalize('NFKC'), salt, KDF.keyLen, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 128 * KDF.N * KDF.r * 2 })
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(aad(header, BACKUP_VERSION))
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const file = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    header,
    kdf: { name: 'scrypt', salt: salt.toString('base64'), N: KDF.N, r: KDF.r, p: KDF.p },
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
  return JSON.stringify(file, null, 1)
}

/** Read the unencrypted header without a passphrase (for the import preview). */
export function readBackupHeader(text: string): { version: number; header: BackupHeader } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupFileError('This is not a Mail City backup file', 'not_a_backup')
  }
  const parsed = FileSchema.safeParse(raw)
  if (!parsed.success) throw new BackupFileError('This is not a Mail City backup file', 'not_a_backup')
  if (parsed.data.version > BACKUP_VERSION) throw new BackupFileError('This backup was made by a newer version of Mail City; update the app first', 'newer_version')
  return { version: parsed.data.version, header: parsed.data.header }
}

export function decryptBackup(text: string, passphrase: string): { header: BackupHeader; payload: unknown } {
  readBackupHeader(text)
  const f = FileSchema.parse(JSON.parse(text))
  const key = scryptSync(passphrase.normalize('NFKC'), Buffer.from(f.kdf.salt, 'base64'), KDF.keyLen, { N: f.kdf.N, r: f.kdf.r, p: f.kdf.p, maxmem: 128 * f.kdf.N * f.kdf.r * 2 })
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'base64'))
  decipher.setAAD(aad(f.header, f.version))
  const tag = Buffer.from(f.tag, 'base64')
  if (tag.length !== 16) throw new BackupFileError('Wrong passphrase or corrupted file', 'wrong_passphrase')
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(Buffer.from(f.data, 'base64')), decipher.final()]).toString('utf8')
    return { header: f.header, payload: JSON.parse(plain) }
  } catch {
    throw new BackupFileError('Wrong passphrase or corrupted file', 'wrong_passphrase')
  }
}
