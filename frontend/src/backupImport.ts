// Restores the notes of a parsed backup into the logged-in account. Each note
// goes through the ordinary createNote() path, so it is encrypted with the
// current data key before it leaves the browser.
import { createNote } from './api'
import type { BackupNote } from './backup'

export interface ImportSummary {
  imported: number
  failed: number
  // True when the API's unverified-account note cap cut the import short.
  stoppedByLimit: boolean
}

// The API rejects the 11th note of an unverified account with a 403 whose
// message asks the user to verify their e-mail (api/function_app.py:371).
// Retrying every remaining note would produce a wall of identical failures,
// so the import stops and says what to do instead.
function isNoteLimit(err: unknown): boolean {
  return err instanceof Error && /verify your e-mail/i.test(err.message)
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
      if (isNoteLimit(err)) return { imported, failed, stoppedByLimit: true }
      failed++
    }
    onProgress?.(i + 1, notes.length)
  }
  return { imported, failed, stoppedByLimit: false }
}
