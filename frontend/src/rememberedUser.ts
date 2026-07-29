// Who last unlocked the vault in this browser. A full page load — refresh, a
// pasted /notes/… link, a PWA cold start — drops the in-memory session
// (session.ts) and would otherwise drop the visitor on the public landing page.
// Remembering the name lets the lock screen ask for the password instead.
//
// The username only: never a token or a key, which stay in memory by design.
// This reveals no more than the per-user keys preferences.ts and offlineCache.ts
// already write (`bpad.pref.sort.<username>`).
const KEY = 'bpad.lastUser'

export function rememberUser(username: string): void {
  try {
    localStorage.setItem(KEY, username)
  } catch {
    /* quota / private mode – best-effort, mirrors the offline cache */
  }
}

export function getRememberedUser(): string | null {
  try {
    return localStorage.getItem(KEY) || null
  } catch {
    return null
  }
}

export function forgetRememberedUser(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to do – the next read falls back to null anyway */
  }
}
