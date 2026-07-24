// Restores the notes of a parsed backup into the logged-in account. Each note
// goes through the ordinary createNote() path, so it is encrypted with the
// current data key before it leaves the browser.
import { createNote } from './api'
import type { BackupNote } from './backup'

export type ImportLimit = 'unverified' | 'hard'

export interface ImportSummary {
  imported: number
  failed: number
  // Which server-side note cap cut the import short, or null if it ran to completion.
  stoppedByLimit: ImportLimit | null
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

// Sequential on purpose: it keeps Cosmos RU consumption flat and makes an
// honest progress indicator possible. A single failure is not fatal — a
// partial restore beats none, and re-running is safe because the caller
// deduplicates first.
export async function importNotes(
  notes: BackupNote[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  let imported = 0
  let failed = 0
  for (const [i, note] of notes.entries()) {
    try {
      await createNote(note.content, note.tags, {
        title: note.title,
        createdAt: note.created_at,
      })
      imported++
    } catch (err) {
      const limit = noteLimitKind(err)
      if (limit) return { imported, failed, stoppedByLimit: limit }
      failed++
    }
    onProgress?.(i + 1, notes.length)
  }
  return { imported, failed, stoppedByLimit: null }
}
