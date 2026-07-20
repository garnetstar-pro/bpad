// Backup file format: serialize the user's decrypted notes into a file they
// can store outside the app, and read such a file back. Pure logic — no UI,
// no network, no browser storage. See
// docs/superpowers/specs/2026-07-20-backup-export-import-design.md
import type { Note } from './types'
import { translate } from './i18n/translate'

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
