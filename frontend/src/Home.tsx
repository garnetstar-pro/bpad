import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { Note } from './types'
import { listNotes, createNote } from './api'
import { filterNotes } from './search'
import { isOfflineReadOnly } from './session'
import Editor from './Editor'
import { useTranslation, translate } from './i18n'

function Home() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetchNotes()
  }, [])

  const fetchNotes = async () => {
    try {
      setLoading(true)
      setNotes(await listNotes())
      setError(null)
    } catch {
      setError(translate('home.connectFailed'))
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (content: string) => {
    const newNote = await createNote(content)
    setNotes((prev) => [newNote, ...prev])
  }

  const filtered = filterNotes(notes, query)
  const searching = query.trim().length > 0

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {!isOfflineReadOnly() && (
        <Editor submitLabel={t('editor.fileIt')} onSubmit={handleCreate} resetOnSuccess />
      )}

      <div className="section-head">
        <span className="section-label">{t('home.recentEntries')}</span>
        {searching && (
          <span className="section-count">
            {filtered.length} / {notes.length}
          </span>
        )}
      </div>

      <div className="search">
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('home.searchPlaceholder')}
        />
        {searching && (
          <button
            className="search-clear"
            onClick={() => setQuery('')}
            type="button"
            aria-label={t('home.clearSearch')}
          >
            ×
          </button>
        )}
      </div>

      <div className="entries">
        {loading && <div className="empty-state">{t('home.loading')}</div>}
        {!loading && notes.length === 0 && (
          <div className="empty-state">{t('home.noEntries')}</div>
        )}
        {!loading && notes.length > 0 && filtered.length === 0 && (
          <div className="empty-state">{t('home.nothingFound')}</div>
        )}
        {filtered.map((note) => (
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
