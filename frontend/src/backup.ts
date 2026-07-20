// Backup file format: serialize the user's decrypted notes into a file they
// can store outside the app, and read such a file back. Pure logic — no UI,
// no network, no browser storage. See
// docs/superpowers/specs/2026-07-20-backup-export-import-design.md
import { argon2id } from 'hash-wasm'
import type { Note } from './types'
import { translate } from './i18n/translate'
import { toBase64, fromBase64, randomBytes, encryptBytes, decryptBytes } from './crypto'

export const BACKUP_FORMAT = 'bpad-backup'
export const BACKUP_VERSION = 1
export const MIN_PASSPHRASE_LENGTH = 12

// A note as it is written to the file. The server-side id is deliberately
// absent: it is meaningless once the notes are restored into another account.
export interface BackupNote {
  title: string
  content: string
  url: string | null
  created_at: string
  updated_at: string
  tags: string[]
}

interface BackupHeader {
  format: typeof BACKUP_FORMAT
  version: number
  exported_at: string
  username: string
}

export interface PlainBackup extends BackupHeader {
  encrypted: false
  notes: BackupNote[]
}

// Argon2id parameters travel inside the file so that raising them in the app
// never makes an old backup unreadable.
export interface BackupKdf {
  algorithm: 'argon2id'
  salt: string // base64
  iterations: number
  memory_size: number
  parallelism: number
  hash_length: number
}

export interface EncryptedBackup extends BackupHeader {
  encrypted: true
  kdf: BackupKdf
  cipher: 'AES-256-GCM'
  iv: string // base64
  ct: string // base64 — the encrypted JSON of { notes: BackupNote[] }
}

export type BackupFile = PlainBackup | EncryptedBackup

export function isEncrypted(file: BackupFile): file is EncryptedBackup {
  return file.encrypted
}

export function serializeBackup(
  notes: Note[],
  meta: { username: string; exportedAt?: string },
): PlainBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: meta.exportedAt ?? new Date().toISOString(),
    username: meta.username,
    encrypted: false,
    notes: notes.map((n) => ({
      title: n.title,
      content: n.content,
      url: n.url,
      created_at: n.created_at,
      updated_at: n.updated_at,
      tags: n.tags,
    })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error(translate('errors.backupUnreadable'))
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    throw new Error(translate('errors.backupNotBpad'))
  }
  if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) {
    throw new Error(translate('errors.backupTooNew'))
  }
  if (raw.encrypted === true) {
    const kdf = raw.kdf
    if (
      !isRecord(kdf) ||
      kdf.algorithm !== 'argon2id' ||
      raw.cipher !== 'AES-256-GCM' ||
      typeof kdf.salt !== 'string' ||
      typeof raw.iv !== 'string' ||
      typeof raw.ct !== 'string'
    ) {
      throw new Error(translate('errors.backupUnsupported'))
    }
    return raw as unknown as EncryptedBackup
  }
  if (!Array.isArray(raw.notes)) {
    throw new Error(translate('errors.backupDamaged'))
  }
  return raw as unknown as PlainBackup
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Defaults for a newly written backup. Reading uses whatever the file says,
// so raising these later leaves old backups readable.
const BACKUP_KDF: Omit<BackupKdf, 'salt'> = {
  algorithm: 'argon2id',
  iterations: 3,
  memory_size: 65536,
  parallelism: 1,
  hash_length: 32,
}

// Derives the AES key from the backup passphrase. Unlike the login path in
// crypto.ts there is no HKDF step: a backup needs one key, not an enc/auth
// pair, and fewer moving parts means the format can be reimplemented from the
// spec years from now. Runs on the calling thread — a backup is a one-off
// action, not something the user waits on repeatedly.
async function deriveBackupKey(passphrase: string, kdf: BackupKdf): Promise<Uint8Array> {
  return argon2id({
    password: passphrase,
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memory_size,
    hashLength: kdf.hash_length,
    outputType: 'binary',
  })
}

export async function encryptBackup(
  backup: PlainBackup,
  passphrase: string,
): Promise<EncryptedBackup> {
  const kdf: BackupKdf = { ...BACKUP_KDF, salt: toBase64(randomBytes(16)) }
  const key = await deriveBackupKey(passphrase, kdf)
  const body = textEncoder.encode(JSON.stringify({ notes: backup.notes }))
  const { iv, ct } = await encryptBytes(body, key)
  return {
    format: backup.format,
    version: backup.version,
    exported_at: backup.exported_at,
    username: backup.username,
    encrypted: true,
    kdf,
    cipher: 'AES-256-GCM',
    iv,
    ct,
  }
}

export async function decryptBackup(
  file: EncryptedBackup,
  passphrase: string,
): Promise<BackupNote[]> {
  const key = await deriveBackupKey(passphrase, file.kdf)
  let bytes: Uint8Array
  try {
    bytes = await decryptBytes({ iv: file.iv, ct: file.ct }, key)
  } catch {
    // AES-GCM cannot tell a wrong key from a damaged file: both fail the tag
    // check. The passphrase is by far the likelier cause, so lead with it.
    throw new Error(translate('errors.backupWrongPassphrase'))
  }
  const body = JSON.parse(textDecoder.decode(bytes)) as { notes?: BackupNote[] }
  if (!Array.isArray(body.notes)) throw new Error(translate('errors.backupDamaged'))
  return body.notes
}

export async function notesOf(file: BackupFile, passphrase?: string): Promise<BackupNote[]> {
  if (!isEncrypted(file)) return file.notes
  if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
  return decryptBackup(file, passphrase)
}
