import type { Note } from './types'

// Free accounts get up to this many DISTINCT tags across the whole account
// (soft, client-side cap). Premium lifts it.
export const FREE_TAG_LIMIT = 12

// How many distinct tags the account would have after saving a note whose
// tags are `noteTags`, given the currently-known tags. Used for the soft cap.
export function distinctTagCount(known: string[], noteTags: string[]): number {
  return new Set([...known, ...noteTags]).size
}

// Single-word, lowercase, no leading '#', no inner whitespace.
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, '').toLowerCase()
}

export function normalizeTags(raw: string[]): string[] {
  const out: string[] = []
  for (const r of raw) {
    const tag = normalizeTag(r)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

// Sorted union of tags across notes — the client-derived "registry".
export function collectTags(notes: Note[]): string[] {
  const set = new Set<string>()
  for (const n of notes) for (const tag of n.tags) set.add(tag)
  return [...set].sort()
}

// AND semantics; untaggedOnly wins and returns only tag-less notes.
export function filterByTags(notes: Note[], selected: string[], untaggedOnly: boolean): Note[] {
  if (untaggedOnly) return notes.filter((n) => n.tags.length === 0)
  if (selected.length === 0) return notes
  return notes.filter((n) => selected.every((tag) => n.tags.includes(tag)))
}
