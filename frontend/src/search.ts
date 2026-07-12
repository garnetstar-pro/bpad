import type { Note } from './types'

// Strips diacritics and unifies case, so „clanek" == „Článek".
// ̀-ͯ = combining diacritical marks (produced by NFD decomposition).
const COMBINING_MARKS = /[̀-ͯ]/g
const normalize = (s: string) =>
  s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()

// Returns the notes whose title or content contains the search term
// (ignoring diacritics and case). An empty query returns everything.
export function filterNotes(notes: Note[], query: string): Note[] {
  const q = normalize(query.trim())
  if (!q) return notes
  return notes.filter((n) => normalize(`${n.title}\n${n.content}`).includes(q))
}
