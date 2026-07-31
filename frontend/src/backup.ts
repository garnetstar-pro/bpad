// Backup file format: serialize the user's decrypted notes into a file they
// can store outside the app, and read such a file back. Pure logic — no UI,
// no network, no browser storage. See
// docs/superpowers/specs/2026-07-20-backup-export-import-design.md
import { argon2id } from 'hash-wasm'
import type { Note } from './types'
import { translate } from './i18n/translate'
import { toBase64, fromBase64, randomBytes, encryptBytes, decryptBytes } from './crypto'
import { normalizeImageRefs } from './imageRefs'

export const BACKUP_FORMAT = 'bpad-backup'
export const BACKUP_VERSION = 2
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

// An image as it is listed in the manifest. `path` locates its bytes inside the
// archive; `size_bytes` is the size of the picture itself, not of the sealed
// file, so it stays meaningful in an encrypted backup.
export interface BackupImage {
  id: string
  content_type: string
  size_bytes: number
  path: string
}

// What a backup actually holds, once opened. Plain and encrypted backups both
// resolve to this.
export interface BackupContent {
  notes: BackupNote[]
  images: BackupImage[]
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
  images: BackupImage[]
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
  ct: string // base64 — the encrypted JSON of { notes: BackupNote[], images: BackupImage[] }
}

export type BackupFile = PlainBackup | EncryptedBackup

export function isEncrypted(file: BackupFile): file is EncryptedBackup {
  return file.encrypted
}

export function serializeBackup(
  notes: Note[],
  meta: { username: string; exportedAt?: string; images?: BackupImage[] },
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
    images: meta.images ?? [],
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
  // A version 1 file has no images key at all.
  return {
    ...(raw as unknown as PlainBackup),
    images: Array.isArray(raw.images) ? (raw.images as BackupImage[]) : [],
  }
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

// Extension by content type so the human-readable export links to something a
// picture viewer recognises. Encrypted archives are always .bin — the bytes are
// not an image until they are opened.
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export function imagePath(id: string, contentType: string, encrypted: boolean): string {
  const ext = encrypted ? 'bin' : (IMAGE_EXTENSIONS[contentType] ?? 'bin')
  return `images/${id}.${ext}`
}

export function newBackupKdf(): BackupKdf {
  return { ...BACKUP_KDF, salt: toBase64(randomBytes(16)) }
}

// Derives the AES key from the backup passphrase. Unlike the login path in
// crypto.ts there is no HKDF step: a backup needs one key, not an enc/auth
// pair, and fewer moving parts means the format can be reimplemented from the
// spec years from now. Runs on the calling thread — a backup is a one-off
// action, not something the user waits on repeatedly.
export async function deriveBackupKey(passphrase: string, kdf: BackupKdf): Promise<Uint8Array> {
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

// Takes an already-derived key: an archive seals its manifest and every image
// with the same key, and Argon2id must run once, not once per file.
export async function encryptBackupWithKey(
  backup: PlainBackup,
  kdf: BackupKdf,
  key: Uint8Array,
): Promise<EncryptedBackup> {
  const body = textEncoder.encode(JSON.stringify({ notes: backup.notes, images: backup.images }))
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

export async function encryptBackup(
  backup: PlainBackup,
  passphrase: string,
): Promise<EncryptedBackup> {
  const kdf = newBackupKdf()
  return encryptBackupWithKey(backup, kdf, await deriveBackupKey(passphrase, kdf))
}

export async function decryptBackupWithKey(
  file: EncryptedBackup,
  key: Uint8Array,
): Promise<BackupContent> {
  let bytes: Uint8Array
  try {
    bytes = await decryptBytes({ iv: file.iv, ct: file.ct }, key)
  } catch {
    // AES-GCM cannot tell a wrong key from a damaged file: both fail the tag
    // check. The passphrase is by far the likelier cause, so lead with it.
    throw new Error(translate('errors.backupWrongPassphrase'))
  }
  const body = JSON.parse(textDecoder.decode(bytes)) as Partial<BackupContent>
  if (!Array.isArray(body.notes)) throw new Error(translate('errors.backupDamaged'))
  return { notes: body.notes, images: Array.isArray(body.images) ? body.images : [] }
}

export async function decryptBackup(
  file: EncryptedBackup,
  passphrase: string,
): Promise<BackupContent> {
  return decryptBackupWithKey(file, await deriveBackupKey(passphrase, file.kdf))
}

// Replaces notesOf: a backup is notes *and* images now.
export async function contentOf(file: BackupFile, passphrase?: string): Promise<BackupContent> {
  if (!isEncrypted(file)) return { notes: file.notes, images: file.images }
  if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
  return decryptBackup(file, passphrase)
}

export interface BackupDiff {
  toImport: BackupNote[]
  duplicates: BackupNote[]
}

// Identity of a note for import purposes. The server-side id is not in the
// file, so a note is "the same note" when it was created at the same instant
// and still says the same thing. Image references are normalised first: an
// import re-uploads every image and rewrites its id, so the raw text of a note
// that has already been restored no longer matches the file it came from.
function identity(n: { created_at: string; content: string }): string {
  return `${n.created_at} ${normalizeImageRefs(n.content)}`
}

// Splits an incoming backup into what is genuinely new and what the vault
// already holds, so that importing the same file twice is a no-op. Identical
// notes within one file collapse too.
export function diffAgainst(existing: Note[], incoming: BackupNote[]): BackupDiff {
  const seen = new Set(existing.map(identity))
  const toImport: BackupNote[] = []
  const duplicates: BackupNote[] = []
  for (const n of incoming) {
    const id = identity(n)
    if (seen.has(id)) {
      duplicates.push(n)
    } else {
      seen.add(id)
      toImport.push(n)
    }
  }
  return { toImport, duplicates }
}
