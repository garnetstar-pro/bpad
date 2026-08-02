// Server-granted entitlements: what this account is allowed to do. Not user
// preferences (those live in preferences.ts) — the values come from the server
// and the user cannot change them here.
import { getUsername } from './session'

// Premium entitlement. Stub until subscriptions ship — wire a real entitlement
// here later. One source of truth so callers don't hardcode `false`.
export function isPremium(): boolean {
  return false
}

// How many distinct images one note may reference. The server is the source of
// truth (getAccount() refreshes this cache); the quota itself is hand-edited in
// the Cosmos `users` container. Cached per user so the editor can enforce it
// without waiting on a request, and offline.
export const DEFAULT_MAX_IMAGES_PER_NOTE = 10

const imageLimitKey = (u: string) => `bpad.limit.images.${u}`

export function getMaxImagesPerNote(): number {
  const u = getUsername()
  if (!u) return DEFAULT_MAX_IMAGES_PER_NOTE
  // The null check has to come first: Number(null) is 0, which would read as
  // "no images allowed" for anyone who has never fetched their account.
  const raw = localStorage.getItem(imageLimitKey(u))
  if (raw === null) return DEFAULT_MAX_IMAGES_PER_NOTE
  const stored = Number(raw)
  return Number.isInteger(stored) && stored >= 0 ? stored : DEFAULT_MAX_IMAGES_PER_NOTE
}

export function setMaxImagesPerNote(limit: number): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(imageLimitKey(u), String(limit))
  } catch {
    /* quota / private mode – best-effort, mirrors the sort preference */
  }
}
