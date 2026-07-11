import type { Note } from './types'
import { getToken, getDataKey, clearSession } from './session'
import { encryptJSON, decryptJSON, type Encrypted } from './crypto'
import { resolveTitle } from './titles'

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

// Tvar, jak poznámka leží na serveru: jen šifra + metadata. Server obsah nevidí.
interface EncryptedNote {
  id: string
  iv: string
  ct: string
  created_at: string
}

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
  if (token) base.Authorization = `Bearer ${token}`
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

// Zašifruje {title, content, url}; titulek se odvodí na klientovi.
async function encryptPayload(content: string, title?: string): Promise<Encrypted> {
  const payload: NotePayload = { title: resolveTitle(title, content), content, url: null }
  return encryptJSON(payload, key())
}

export async function listNotes(): Promise<Note[]> {
  const res = await fetch(API_URL, { headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Nepodařilo se načíst poznámky')
  const encrypted: EncryptedNote[] = await res.json()
  return Promise.all(encrypted.map(decrypt))
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`, { headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Poznámka nenalezena')
  return decrypt(await res.json())
}

export async function createNote(content: string): Promise<Note> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(await encryptPayload(content)),
  })
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
  return decrypt(await res.json())
}

export async function updateNote(id: string, content: string, title?: string): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(await encryptPayload(content, title)),
  })
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
  return decrypt(await res.json())
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Smazání selhalo')
}
