import type { Note } from './types'

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function listNotes(): Promise<Note[]> {
  const res = await fetch(API_URL)
  if (!res.ok) throw new Error('Nepodařilo se načíst poznámky')
  return res.json()
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`)
  if (!res.ok) throw new Error('Poznámka nenalezena')
  return res.json()
}

export async function createNote(content: string): Promise<Note> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Uložení selhalo')
  return res.json()
}

export async function updateNote(id: string, content: string): Promise<Note> {
  const res = await fetch(`${API_URL}/${id}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Uložení selhalo')
  return res.json()
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Smazání selhalo')
}
