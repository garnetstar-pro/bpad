// Replacing a selection in a text field and knowing where the caret belongs
// afterwards. Kept separate from the editor so it stays testable: the suite
// runs without jsdom, so anything that needs a real textarea cannot be covered.
export interface Insertion {
  text: string
  caret: number
}

// Replace [start, end) with snippet. The caret lands right after what was
// inserted, the way it does after an ordinary paste.
//
// The bounds are clamped because the caller reads them before an await (the
// image upload) and the draft may have grown or shrunk in the meantime — a
// stale index must not slice outside the string or fold the caret backwards.
export function insertAt(text: string, start: number, end: number, snippet: string): Insertion {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return {
    text: text.slice(0, from) + snippet + text.slice(to),
    caret: from + snippet.length,
  }
}
