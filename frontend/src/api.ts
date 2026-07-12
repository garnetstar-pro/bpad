import type { Note } from './types'
import { getToken, getDataKey, getUsername, clearSession } from './session'
import { encryptJSON, decryptJSON, type Encrypted } from './crypto'
import { resolveTitle } from './titles'
import {
  cacheNotes,
  getCachedNotes,
  upsertCachedNote,
  removeCachedNote,
  type EncryptedNote,
} from './offlineCache'
import { translate } from './i18n'

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

// Last known note count for the user – for the counter in the unverified
// account's banner. Updated on list/create/delete and dispatches an event
// that App re-evaluates.
let knownNoteCount: number | null = null
export function getKnownNoteCount(): number | null {
  return knownNoteCount
}
function setKnownNoteCount(n: number | null): void {
  knownNoteCount = n
  window.dispatchEvent(new Event('bpad:notes-changed'))
}

// Decrypted payload inside the ciphertext.
interface NotePayload {
  title: string
  content: string
  url: string | null
}

function key(): Uint8Array {
  const k = getDataKey()
  if (!k) throw new Error(translate('errors.vaultLocked'))
  return k
}

function headers(): Record<string, string> {
  const token = getToken()
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) base['X-Auth-Token'] = token
  return base
}

function checkAuth(res: Response): void {
  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new Event('bpad:unauthorized'))
    throw new Error(translate('errors.sessionExpired'))
  }
}

async function decrypt(enc: EncryptedNote): Promise<Note> {
  const payload = await decryptJSON<NotePayload>({ iv: enc.iv, ct: enc.ct }, key())
  return {
    id: enc.id,
    title: payload.title,
    content: payload.content,
    url: payload.url,
    created_at: enc.created_at,
  }
}

async function encryptPayload(content: string, title?: string): Promise<Encrypted> {
  const payload: NotePayload = { title: resolveTitle(title, content), content, url: null }
  return encryptJSON(payload, key())
}

export async function listNotes(): Promise<Note[]> {
  const username = getUsername()
  let res: Response
  try {
    res = await fetch(API_URL, { headers: headers() })
  } catch {
    // Network unavailable → read from the local cache.
    const cached = username ? getCachedNotes(username) : null
    if (cached) {
      setKnownNoteCount(cached.length)
      return Promise.all(cached.map(decrypt))
    }
    throw new Error(translate('errors.offlineNoNotes'))
  }
  checkAuth(res)
  if (!res.ok) throw new Error(translate('errors.loadFailed'))
  const encrypted: EncryptedNote[] = await res.json()
  if (username) cacheNotes(username, encrypted) // store for offline reading
  setKnownNoteCount(encrypted.length)
  return Promise.all(encrypted.map(decrypt))
}

export async function getNote(id: string): Promise<Note> {
  const username = getUsername()
  let res: Response
  try {
    res = await fetch(`${API_URL}/${id}`, { headers: headers() })
  } catch {
    const found = (username ? getCachedNotes(username) : null)?.find((n) => n.id === id)
    if (found) return decrypt(found)
    throw new Error(translate('errors.noteNotOffline'))
  }
  checkAuth(res)
  if (!res.ok) throw new Error(translate('errors.noteNotFound'))
  return decrypt(await res.json())
}

export async function createNote(content: string): Promise<Note> {
  let res: Response
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(await encryptPayload(content)),
    })
  } catch {
    throw new Error(translate('errors.offlineWrite'))
  }
  checkAuth(res)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || translate('errors.saveFailed'))
  }
  const enc: EncryptedNote = await res.json()
  const username = getUsername()
  if (username) upsertCachedNote(username, enc)
  if (knownNoteCount !== null) setKnownNoteCount(knownNoteCount + 1)
  return decrypt(enc)
}

export async function updateNote(id: string, content: string, title?: string): Promise<Note> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(await encryptPayload(content, title)),
    })
  } catch {
    throw new Error(translate('errors.offlineWrite'))
  }
  checkAuth(res)
  if (!res.ok) throw new Error(translate('errors.saveFailed'))
  const enc: EncryptedNote = await res.json()
  const username = getUsername()
  if (username) upsertCachedNote(username, enc)
  return decrypt(enc)
}

export async function deleteNote(id: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: headers() })
  } catch {
    throw new Error(translate('errors.offlineWrite'))
  }
  checkAuth(res)
  if (!res.ok) throw new Error(translate('errors.deleteFailed'))
  const username = getUsername()
  if (username) removeCachedNote(username, id)
  if (knownNoteCount !== null && knownNoteCount > 0) setKnownNoteCount(knownNoteCount - 1)
}
