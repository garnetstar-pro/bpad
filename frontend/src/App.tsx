import { useState } from 'react'
import './App.css'

interface Note {
  id: string
  content: string
  createdAt: Date
}

function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')

  const handleSave = () => {
    if (!draft.trim()) return

    const newNote: Note = {
      id: crypto.randomUUID(),
      content: draft,
      createdAt: new Date(),
    }

    setNotes([newNote, ...notes])
    setDraft('')
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

      <div className="capture">
        <div className="capture-label">new entry</div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a thought or paste a link…"
        />
        <div className="capture-footer">
          <span className="capture-hint">enter = save</span>
          <button className="save-btn" onClick={handleSave}>
            File it
          </button>
        </div>
      </div>

      <div className="section-label">recent entries</div>

      <div className="entries">
        {notes.length === 0 && (
          <div className="empty-state">no entries yet</div>
        )}
        {notes.map((note) => (
          <div className="entry" key={note.id}>
            <div className="entry-stamp">
              {note.createdAt.toLocaleTimeString([], {
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