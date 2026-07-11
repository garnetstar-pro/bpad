import type { Note } from './types'
import { getToken, clearSession } from './session'

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

function headers(): Record<string, string> {
  const token = getToken()
  const base: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) base.Authorization = `Bearer ${token}`
  return base
}

// Vypršelá/neplatná session → odhlásit (návrat na login).
function checkAuth(res: Response): void {
  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new Event('bpad:unauthorized'))
    throw new Error('Přihlášení vypršelo')
  }
}

export async function listNotes(): Promise<Note[]> {
  const res = await fetch(API_URL, { headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Nepodařilo se načíst poznámky')
  return res.json()
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`, { headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Poznámka nenalezena')
  return res.json()
}

export async function createNote(content: string): Promise<Note> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ content }),
  })
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
  return res.json()
}

export async function updateNote(
  id: string,
  content: string,
  title?: string,
): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ content, title }),
  })
  checkAuth(res)
  if (!res.ok) throw new Error('Uložení selhalo')
  return res.json()
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: headers() })
  checkAuth(res)
  if (!res.ok) throw new Error('Smazání selhalo')
}
