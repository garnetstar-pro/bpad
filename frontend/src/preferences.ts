// Non-secret UI preferences. Cached in localStorage (per user) for instant,
// offline-tolerant reads; the server is the source of truth (seeded via
// getAccount, written via savePreferences in authApi).
import { getUsername } from './session'
import { isTouchPrimary } from './device'

export type SortField = 'created' | 'modified'

const sortKey = (u: string) => `bpad.pref.sort.${u}`
const autoLockKey = (u: string) => `bpad.pref.autolock.${u}`

// Sentinel stored in localStorage for "never lock" (distinguishable from
// "nothing stored yet"). Server uses 0 for the same purpose.
const NEVER_SENTINEL = '0'

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

/**
 * Device-specific default timeout in minutes.
 * Desktop: 5 minutes (preserves current behaviour).
 * Touch/mobile: null = never (preserves current behaviour).
 */
export function deviceDefaultAutoLock(): number | null {
  return isTouchPrimary() ? null : 5
}

/**
 * Get the current auto-lock timeout in minutes, or null for "never".
 * Falls back to deviceDefaultAutoLock() when the user has not yet set a preference.
 */
export function getAutoLockPref(): number | null {
  const u = getUsername()
  if (!u) return deviceDefaultAutoLock()
  const raw = localStorage.getItem(autoLockKey(u))
  if (raw === null) return deviceDefaultAutoLock()
  const n = parseInt(raw, 10)
  if (isNaN(n)) return deviceDefaultAutoLock()
  return n === 0 ? null : n
}

/**
 * Persist the auto-lock timeout.
 * Pass null to mean "never lock"; pass a positive number for minutes.
 */
export function setAutoLockPref(minutes: number | null): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(autoLockKey(u), minutes === null ? NEVER_SENTINEL : String(minutes))
  } catch {
    /* quota / private mode – best-effort */
  }
}
