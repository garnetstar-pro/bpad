// Assembles and reads a version 2 backup archive. Pure: bytes in, bytes out —
// no network, no DOM, no browser storage. The layout is
//   backup.json            the manifest (plain or sealed)
//   images/<id>.<ext>      picture bytes (.bin when sealed)
//   notes/<date>-<slug>.md readable copy, plain archives only
import { zipFiles, unzipFiles, type ZipEntry } from './backupZip'
import { buildMarkdownFiles } from './backupMarkdown'
import { sealBytes, openBytes } from './crypto'
import { translate } from './i18n/translate'
import {
  serializeBackup,
  parseBackup,
  isEncrypted,
  newBackupKdf,
  deriveBackupKey,
  encryptBackupWithKey,
  decryptBackupWithKey,
  imagePath,
  type BackupContent,
  type BackupFile,
  type BackupImage,
  type BackupNote,
} from './backup'
import type { Note } from './types'

const MANIFEST = 'backup.json'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// An image on its way in or out of an archive: always the *plaintext* picture.
// Sealing happens inside buildArchive and unsealing inside openArchive.
export interface ArchiveImage {
  id: string
  content_type: string
  bytes: Uint8Array
}

export interface BuildArchiveInput {
  notes: Note[]
  images: ArchiveImage[]
  username: string
  exportedAt?: string
  // Undefined means a plain archive.
  passphrase?: string
}

function json(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value, null, 2))
}

export async function buildArchive(input: BuildArchiveInput): Promise<Uint8Array> {
  const encrypted = input.passphrase !== undefined && input.passphrase !== ''
  const manifest: BackupImage[] = input.images.map((img) => ({
    id: img.id,
    content_type: img.content_type,
    size_bytes: img.bytes.length,
    path: imagePath(img.id, img.content_type, encrypted),
  }))
  const plain = serializeBackup(input.notes, {
    username: input.username,
    exportedAt: input.exportedAt,
    images: manifest,
  })

  const files: Record<string, ZipEntry> = {}

  if (encrypted) {
    // One Argon2id run for the whole archive: the manifest and every image are
    // sealed with the same key.
    const kdf = newBackupKdf()
    const key = await deriveBackupKey(input.passphrase as string, kdf)
    files[MANIFEST] = { bytes: json(await encryptBackupWithKey(plain, kdf, key)) }
    for (const [i, img] of input.images.entries()) {
      files[manifest[i].path] = { bytes: await sealBytes(img.bytes, key), compress: false }
    }
    return zipFiles(files)
  }

  files[MANIFEST] = { bytes: json(plain) }
  for (const [i, img] of input.images.entries()) {
    files[manifest[i].path] = { bytes: img.bytes, compress: false }
  }
  const paths = new Map(manifest.map((m) => [m.id, `../${m.path}`]))
  for (const [name, text] of Object.entries(buildMarkdownFiles(plain.notes, paths))) {
    files[`notes/${name}`] = { bytes: textEncoder.encode(text) }
  }
  return zipFiles(files)
}

// Stage one of reading: the header is needed before the passphrase can be
// asked for, so unpacking and unlocking are separate steps.
export interface ArchiveHandle {
  file: BackupFile
  entries: Record<string, Uint8Array>
}

export function readArchive(bytes: Uint8Array): ArchiveHandle {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipFiles(bytes)
  } catch {
    throw new Error(translate('errors.backupUnreadable'))
  }
  const manifest = entries[MANIFEST]
  if (!manifest) throw new Error(translate('errors.backupNotBpad'))
  return { file: parseBackup(textDecoder.decode(manifest)), entries }
}

export interface OpenedBackup {
  notes: BackupNote[]
  // Keyed by the id the archive was written with — import maps these to fresh ids.
  images: Map<string, ArchiveImage>
}

export async function openArchive(
  handle: ArchiveHandle,
  passphrase?: string,
): Promise<OpenedBackup> {
  // Bound to a const so isEncrypted() narrows it — narrowing a property access
  // does not survive the awaits below.
  const file = handle.file
  let key: Uint8Array | null = null
  let content: BackupContent
  if (isEncrypted(file)) {
    if (!passphrase) throw new Error(translate('errors.backupNeedsPassphrase'))
    key = await deriveBackupKey(passphrase, file.kdf)
    content = await decryptBackupWithKey(file, key)
  } else {
    content = { notes: file.notes, images: file.images }
  }

  const images = new Map<string, ArchiveImage>()
  for (const entry of content.images) {
    const raw = handle.entries[entry.path]
    // A manifest entry with no file behind it means a picture that failed to
    // download when the backup was written, or a hand-edited archive. The note
    // still restores, with one broken image.
    if (!raw) continue
    images.set(entry.id, {
      id: entry.id,
      content_type: entry.content_type,
      bytes: key ? await openBytes(raw, key) : raw,
    })
  }
  return { notes: content.notes, images }
}
