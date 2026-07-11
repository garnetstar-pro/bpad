import type { Note } from './types'

// Odstraní diakritiku a sjednotí velikost písmen, aby „clanek" == „Článek".
// ̀-ͯ = kombinující diakritická znaménka (vzniknou z NFD rozkladu).
const COMBINING_MARKS = /[̀-ͯ]/g
const normalize = (s: string) =>
  s.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase()

// Vrátí poznámky, jejichž titulek nebo obsah obsahuje hledaný výraz
// (bez ohledu na diakritiku a velikost písmen). Prázdný dotaz vrátí vše.
export function filterNotes(notes: Note[], query: string): Note[] {
  const q = normalize(query.trim())
  if (!q) return notes
  return notes.filter((n) => normalize(`${n.title}\n${n.content}`).includes(q))
}
