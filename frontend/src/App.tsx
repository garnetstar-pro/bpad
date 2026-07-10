import { useState, useEffect, useRef } from 'react'
import './App.css'


interface Note {
  id: string
  content: string
  url: string | null
  created_at: string
}

const API_URL = import.meta.env.DEV 
  ? 'http://localhost:7071/api/notes' 
  : '/api/notes'

function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Načíst poznámky při startu appky
  useEffect(() => {
    fetchNotes()
    textareaRef.current?.focus()
  }, [])

  // Vrátit fokus do textarey, jakmile se znovu povolí po uložení
  useEffect(() => {
    if (!saving) textareaRef.current?.focus()
  }, [saving])

  const fetchNotes = async () => {
    try {
      setLoading(true)
      const res = await fetch(API_URL)
      if (!res.ok) throw new Error('Nepodařilo se načíst poznámky')
      const data: Note[] = await res.json()
      setNotes(data)
      setError(null)
    } catch (err) {
      setError('Nepodařilo se spojit s backendem. Běží func start?')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!draft.trim()) return

    try {
      setSaving(true)
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      if (!res.ok) throw new Error('Uložení selhalo')

      const newNote: Note = await res.json()
      setNotes([newNote, ...notes])
      setDraft('')
      setError(null)
    } catch (err) {
      setError('Uložení se nepovedlo. Zkus to znovu.')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <div className="case-number">case file · bpad.pro</div>
          <div className="app-title">bpad</div>
        </div>
        <div className="app-meta">
          entries: {String(notes.length).padStart(3, '0')}
          <br />
          access: you only
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="capture">
        <div className="capture-label">new entry</div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a thought or paste a link…"
          disabled={saving}
        />
        <div className="capture-footer">
          <span className="capture-hint">
            {saving ? 'saving…' : 'enter = save'}
          </span>
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            File it
          </button>
        </div>
      </div>

      <div className="section-label">recent entries</div>

      <div className="entries">
        {loading && <div className="empty-state">loading…</div>}
        {!loading && notes.length === 0 && (
          <div className="empty-state">no entries yet</div>
        )}
        {notes.map((note) => (
          <div className="entry" key={note.id}>
            <div className="entry-stamp">
              {new Date(note.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div className="entry-body">
              <div className="entry-title">{note.content}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App