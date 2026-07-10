import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Note } from './types'
import { listNotes, createNote } from './api'
import Editor from './Editor'

function Home() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchNotes()
  }, [])

  const fetchNotes = async () => {
    try {
      setLoading(true)
      setNotes(await listNotes())
      setError(null)
    } catch {
      setError('Nepodařilo se spojit s backendem. Běží func start?')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (content: string) => {
    const newNote = await createNote(content)
    setNotes((prev) => [newNote, ...prev])
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <Editor submitLabel="File it" onSubmit={handleCreate} resetOnSuccess />

      <div className="section-label">recent entries</div>

      <div className="entries">
        {loading && <div className="empty-state">loading…</div>}
        {!loading && notes.length === 0 && (
          <div className="empty-state">no entries yet</div>
        )}
        {notes.map((note) => (
          <Link className="entry" key={note.id} to={`/notes/${note.id}`}>
            <div className="entry-stamp">
              {new Date(note.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div className="entry-body">
              <div className="entry-title">{note.title}</div>
            </div>
            <div className="entry-chevron">›</div>
          </Link>
        ))}
      </div>
    </>
  )
}

export default Home
