// Restores a parsed backup into the logged-in account. Images go first: each
// one is uploaded to this account, and only then are the notes created with
// their references pointed at the new ids. Every note goes through the ordinary
// createNote() path, so it is encrypted with the current data key before it
// leaves the browser, and createNote() parses image_ids out of the rewritten
// content itself — which is what claims the fresh uploads and saves them from
// the server's 24-hour sweep of pending images.
import { createNote } from './api'
import { uploadImage, UploadRateLimited } from './images'
import { parseImageIds, rewriteImageRefs } from './imageRefs'
import { toArrayBuffer } from './crypto'
import type { ArchiveImage } from './backupArchive'
import type { BackupNote } from './backup'

export type ImportLimit = 'unverified' | 'hard' | 'images'

export interface ImportSummary {
  imported: number
  failed: number
  imagesUploaded: number
  imagesFailed: number
  // Which limit cut the import short, or null if it ran to completion.
  stoppedByLimit: ImportLimit | null
}

export interface ImportProgress {
  phase: 'images' | 'notes'
  done: number
  total: number
}

// The API rejects an over-limit create with a 403. Two distinct caps produce two
// messages: an unverified account hitting 10 notes asks the user to verify their
// e-mail; any account hitting the hard per-account ceiling returns "Note limit
// reached" (api/function_app.py). Retrying every remaining note would produce a
// wall of identical failures, so the import stops and says what to do instead.
function noteLimitKind(err: unknown): ImportLimit | null {
  if (!(err instanceof Error)) return null
  if (/verify your e-mail/i.test(err.message)) return 'unverified'
  if (/note limit reached/i.test(err.message)) return 'hard'
  return null
}

export async function importBackup(
  notes: BackupNote[],
  images: Map<string, ArchiveImage>,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportSummary> {
  // Only images the incoming notes actually reference. The caller has already
  // dropped duplicate notes, so images that belong solely to those are never
  // uploaded.
  const ids = [...new Set(notes.flatMap((n) => parseImageIds(n.content)))].filter((id) =>
    images.has(id),
  )

  const remapped = new Map<string, string>()
  let imagesUploaded = 0
  let imagesFailed = 0

  for (const [i, id] of ids.entries()) {
    onProgress?.({ phase: 'images', done: i, total: ids.length })
    const image = images.get(id) as ArchiveImage
    try {
      const blob = new Blob([toArrayBuffer(image.bytes)], { type: image.content_type })
      remapped.set(id, await uploadImage(blob))
      imagesUploaded++
    } catch (err) {
      if (err instanceof UploadRateLimited) {
        // Stop everything, not just the images. Creating the notes now would
        // save them with references that point nowhere, and the next run would
        // recognise them as duplicates and never fill the pictures back in.
        return { imported: 0, failed: 0, imagesUploaded, imagesFailed, stoppedByLimit: 'images' }
      }
      imagesFailed++
    }
  }
  onProgress?.({ phase: 'images', done: ids.length, total: ids.length })

  // Sequential on purpose: it keeps Cosmos RU consumption flat and makes an
  // honest progress indicator possible. A single failure is not fatal — a
  // partial restore beats none, and re-running is safe because the caller
  // deduplicates first.
  let imported = 0
  let failed = 0
  for (const [i, note] of notes.entries()) {
    onProgress?.({ phase: 'notes', done: i, total: notes.length })
    try {
      await createNote(rewriteImageRefs(note.content, remapped), note.tags, {
        title: note.title,
        createdAt: note.created_at,
      })
      imported++
    } catch (err) {
      const limit = noteLimitKind(err)
      if (limit) return { imported, failed, imagesUploaded, imagesFailed, stoppedByLimit: limit }
      failed++
    }
  }
  onProgress?.({ phase: 'notes', done: notes.length, total: notes.length })
  return { imported, failed, imagesUploaded, imagesFailed, stoppedByLimit: null }
}
