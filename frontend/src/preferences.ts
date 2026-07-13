// Non-secret UI preference: which field the Home note list sorts by. Cached in
// localStorage (per user) for instant, offline-tolerant reads; the server is the
// source of truth (seeded via getAccount, written via savePreferences in authApi).
import { getUsername } from './session'

export type SortField = 'created' | 'modified'

const sortKey = (u: string) => `bpad.pref.sort.${u}`

export function getSortPref(): SortField {
  const u = getUsername()
  if (!u) return 'created'
  return localStorage.getItem(sortKey(u)) === 'modified' ? 'modified' : 'created'
}

export function setSortPref(field: SortField): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(sortKey(u), field)
  } catch {
    /* quota / private mode – best-effort, mirrors the offline cache */
  }
}
