import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'


interface Note {
  id: string
  title: string
  content: string
  url: string | null
  created_at: string
}

const API_URL = import.meta.env.DEV
  ? 'http://localhost:7071/api/notes'
  : '/api/notes'

// Konfigurace: do kolika řádků textarea poroste s obsahem.
// Po překročení tohoto limitu se výška zafixuje a objeví se posuvník.
const MAX_TEXTAREA_ROWS = 12

function App() {
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Načíst poznámky při startu appky
  useEffect(() => {
    fetchNotes()
    textareaRef.current?.focus()
  }, [])

  // Vrátit fokus do textarey, jakmile se znovu povolí po uložení (jen v režimu psaní)
  useEffect(() => {
    if (!saving && mode === 'write') textareaRef.current?.focus()
  }, [saving, mode])

  // Přizpůsobit výšku textarey obsahu (roste do MAX_TEXTAREA_ROWS, pak posuvník)
  const autoResize = () => {
    const ta = textareaRef.current
    if (!ta) return
    const cs = getComputedStyle(ta)
    const lineHeight = parseFloat(cs.lineHeight)
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const maxHeight = lineHeight * MAX_TEXTAREA_ROWS + padding + border

    ta.style.height = 'auto'
    const needed = ta.scrollHeight + border
    if (needed > maxHeight) {
      ta.style.height = `${maxHeight}px`
      ta.style.overflowY = 'auto'
    } else {
      ta.style.height = `${needed}px`
      ta.style.overflowY = 'hidden'
    }
  }

  // Přepočítat výšku při změně obsahu i po návratu z náhledu do editoru
  useEffect(() => {
    autoResize()
  }, [draft, mode])

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
      setMode('write')
      setError(null)
    } catch (err) {
      setError('Uložení se nepovedlo. Zkus to znovu.')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter (nebo Cmd+Enter na Macu) uloží; samotný Enter dělá nový řádek
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
        <div className="capture-tabs">
          <button
            className={`capture-tab ${mode === 'write' ? 'is-active' : ''}`}
            onClick={() => setMode('write')}
            type="button"
          >
            Write
          </button>
          <button
            className={`capture-tab ${mode === 'preview' ? 'is-active' : ''}`}
            onClick={() => setMode('preview')}
            type="button"
          >
            Preview
          </button>
        </div>

        {mode === 'write' ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Write a thought or paste a link…"
            disabled={saving}
          />
        ) : (
          <div className="capture-preview markdown-body">
            {draft.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
            ) : (
              <div className="empty-state">nothing to preview</div>
            )}
          </div>
        )}

        <div className="capture-footer">
          <span className="capture-hint">
            {saving ? 'saving…' : 'ctrl+enter or click “File it”'}
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
              <div className="entry-title">{note.title}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default App