// Export orchestration: collect the notes, pull down every image they
// reference, hand it all to backupArchive. The only module in the backup chain
// that touches the network on the way out.
import { listNotes } from './api'
import { parseImageIds } from './imageRefs'
import { downloadImage } from './images'
import { buildArchive, type ArchiveImage } from './backupArchive'

export type ExportPhase = 'images' | 'packing'

export interface ExportProgress {
  phase: ExportPhase
  done: number
  total: number
}

export interface ExportResult {
  archive: Uint8Array
  exportedAt: string
  noteCount: number
  imageCount: number
  // Ids that could not be fetched. Their notes are still exported, with a
  // reference that will not resolve — an honest gap beats a silent one.
  missingImages: string[]
}

export async function exportBackup(opts: {
  username: string
  passphrase?: string
  onProgress?: (progress: ExportProgress) => void
}): Promise<ExportResult> {
  // listNotes() falls back to the offline cache, so a backup still works
  // without the network — it just backs up what this device knows.
  const notes = await listNotes()
  const ids = [...new Set(notes.flatMap((n) => parseImageIds(n.content)))]

  const images: ArchiveImage[] = []
  const missingImages: string[] = []
  // Sequential on purpose: flat load on the blob account and an honest
  // progress indicator, the same reasoning as the import side.
  for (const [i, id] of ids.entries()) {
    opts.onProgress?.({ phase: 'images', done: i, total: ids.length })
    try {
      const { bytes, contentType } = await downloadImage(id)
      images.push({ id, content_type: contentType, bytes })
    } catch {
      missingImages.push(id)
    }
  }
  opts.onProgress?.({ phase: 'images', done: ids.length, total: ids.length })
  opts.onProgress?.({ phase: 'packing', done: ids.length, total: ids.length })

  const exportedAt = new Date().toISOString()
  const archive = await buildArchive({
    notes,
    images,
    username: opts.username,
    exportedAt,
    passphrase: opts.passphrase,
  })
  return {
    archive,
    exportedAt,
    noteCount: notes.length,
    imageCount: images.length,
    missingImages,
  }
}
