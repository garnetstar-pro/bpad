// Local cache for offline reading (localStorage, per user). Stores ONLY the
// notes' ciphertext + public auth material (salt, wrapped dataKey) – never
// plaintext or the password. Best-effort (quota errors are ignored).
import type { Encrypted } from './crypto'

export interface EncryptedNote {
  id: string
  iv: string
  ct: string
  created_at: string
}

export interface OfflineAuth {
  salt: string
  wrappedDataKeyPw: Encrypted
}

const notesKey = (u: string) => `bpad.cache.notes.${u}`
const authKey = (u: string) => `bpad.cache.auth.${u}`

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode – the offline cache is best-effort */
  }
}

export function cacheNotes(username: string, notes: EncryptedNote[]): void {
  writeJson(notesKey(username), notes)
}

export function getCachedNotes(username: string): EncryptedNote[] | null {
  return readJson<EncryptedNote[]>(notesKey(username))
}

// Keep the cache in sync with writes (so offline reading shows the current state).
export function upsertCachedNote(username: string, note: EncryptedNote): void {
  const list = getCachedNotes(username) ?? []
  const idx = list.findIndex((n) => n.id === note.id)
  if (idx >= 0) list[idx] = note
  else list.unshift(note)
  cacheNotes(username, list)
}

export function removeCachedNote(username: string, id: string): void {
  const list = getCachedNotes(username)
  if (list) cacheNotes(username, list.filter((n) => n.id !== id))
}

export function cacheAuth(username: string, auth: OfflineAuth): void {
  writeJson(authKey(username), auth)
}

export function getCachedAuth(username: string): OfflineAuth | null {
  return readJson<OfflineAuth>(authKey(username))
}
