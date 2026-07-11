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

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

// Dešifrovaný payload uvnitř šifry.
interface NotePayload {
  title: string
  content: string
  url: string | null
}

function key(): Uint8Array {
  const k = getDataKey()
  if (!k) throw new Error('Trezor není odemčený')
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
    throw new Error('Přihlášení vypršelo')
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

const OFFLINE_WRITE = 'Jsi offline – změny nejdou uložit.'

export async function listNotes(): Promise<Note[]> {
  const username = getUsername()
  let res: Response
  try {
    res = await fetch(API_URL, { headers: headers() })
  } catch {
    // Síť nedostupná → čti z lokální cache.
    const cached = username ? getCachedNotes(username) : null
    if (cached) return Promise.all(cached.map(decrypt))
    throw new Error('Offline a bez uložených poznámek')
  }
  checkAuth(res)
  if (!res.ok) throw new Error('Nepodařilo se načíst poznámky')
  const encrypted: EncryptedNote[] = await res.json()
  if (username) cacheNotes(username, encrypted) // uložit pro offline čtení
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
    throw new Error('Poznámka není offline dostupná')
  }
  checkAuth(res)
  if (!res.ok) throw new Error('Poznámka nenalezena')
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
    throw new Error(OFFLINE_WRITE)
  }
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
  const enc: EncryptedNote = await res.json()
  const username = getUsername()
  if (username) upsertCachedNote(username, enc)
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
    throw new Error(OFFLINE_WRITE)
  }
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
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
    throw new Error(OFFLINE_WRITE)
  }
  checkAuth(res)
  if (!res.ok) throw new Error('Smazání selhalo')
  const username = getUsername()
  if (username) removeCachedNote(username, id)
}
