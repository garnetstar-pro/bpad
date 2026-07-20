// The browser side of backups: turning a BackupFile into a download, and a
// picked File back into text. Isolated from backup.ts so that the format
// logic stays testable without touching browser APIs.
import { isEncrypted, type BackupFile } from './backup'

export function backupFilename(file: BackupFile): string {
  const day = file.exported_at.slice(0, 10)
  return `bpad-backup-${day}.${isEncrypted(file) ? 'bpad' : 'json'}`
}

export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFilename(file)
  a.click()
  URL.revokeObjectURL(url)
}

export function readTextFile(file: File): Promise<string> {
  return file.text()
}
