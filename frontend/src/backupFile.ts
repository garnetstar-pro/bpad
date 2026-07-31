// The browser side of backups: turning an archive into a download, and a picked
// File into something the format layer can read. Isolated from backup.ts and
// backupArchive.ts so the format logic stays testable without DOM APIs.
import { looksLikeZip } from './backupZip'
import { readArchive, type ArchiveHandle } from './backupArchive'
import { parseBackup } from './backup'
import { toArrayBuffer } from './crypto'

export function archiveFilename(exportedAt: string, encrypted: boolean): string {
  const day = exportedAt.slice(0, 10)
  return `bpad-backup-${day}${encrypted ? '-enc' : ''}.zip`
}

export function downloadArchive(archive: Uint8Array, filename: string): void {
  const blob = new Blob([toArrayBuffer(archive)], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Accepts both a version 2 archive and a version 1 JSON/.bpad file. The old
// format has no images, so it opens as an archive with no entries and every
// caller downstream works unchanged.
export async function openBackupFile(file: File): Promise<ArchiveHandle> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (looksLikeZip(bytes)) return readArchive(bytes)
  return { file: parseBackup(new TextDecoder().decode(bytes)), entries: {} }
}
