import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Note } from './types'
import { getKnownTags, listNotes, createNote } from './api'
import { filterNotes } from './search'
import { filterByTags } from './tags'
import { isOfflineReadOnly } from './session'
import Editor from './Editor'
import { TagBar } from './TagBar'
import { TagPills } from './TagPills'
import { useTranslation, translate } from './i18n'

function Home() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const selected = (searchParams.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const untaggedOnly = searchParams.get('untagged') === '1'

  const setSelected = (next: string[]) => {
    const params = new URLSearchParams(searchParams)
    params.delete('untagged')
    if (next.length) params.set('tags', next.join(','))
    else params.delete('tags')
    setSearchParams(params, { replace: true })
  }
  const toggleTag = (tag: string) =>
    setSelected(selected.includes(tag) ? selected.filter((x) => x !== tag) : [...selected, tag])
  const toggleUntagged = () => {
    const params = new URLSearchParams()
    if (!untaggedOnly) params.set('untagged', '1')
    setSearchParams(params, { replace: true })
  }

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

  const handleCreate = async (content: string, _title?: string, tags?: string[]) => {
    const newNote = await createNote(content, tags ?? [])
    setNotes((prev) => [newNote, ...prev])
  }

  const filtered = filterByTags(filterNotes(notes, query), selected, untaggedOnly)
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

      <TagBar
        tags={getKnownTags()}
        selected={selected}
        untaggedOnly={untaggedOnly}
        onToggleTag={toggleTag}
        onToggleUntagged={toggleUntagged}
      />

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
          <div className="entry" key={note.id}>
            {/* The row is the note link; pills are siblings (no anchor-in-anchor). */}
            <Link className="entry-main" to={`/notes/${note.id}`}>
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
            <TagPills tags={note.tags} />
          </div>
        ))}
      </div>
    </>
  )
}

export default Home
