import { useState, useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Note } from './types'
import { getKnownTags, listNotes, createNote } from './api'
import { filterNotes } from './search'
import { filterByTags, normalizeTag } from './tags'
import { isOfflineReadOnly } from './session'
import Editor from './Editor'
import { TagBar } from './TagBar'
import { TagPills } from './TagPills'
import { useTranslation, translate } from './i18n'
import { getSortPref, setSortPref, type SortField } from './preferences'
import { savePreferences, getAccount } from './authApi'

function Home() {
  const { t } = useTranslation()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortField>(() => getSortPref())
  // Set once the user picks a sort field, so the async server seed below never
  // overwrites a choice the user has already made this session.
  const userChoseSort = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  // Normalize (lowercase) so a filter is case-insensitive even from a hand-typed URL.
  const selected = (searchParams.get('tags') ?? '').split(',').map(normalizeTag).filter(Boolean)
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

  // Seed the sort preference from the server (source of truth) so it follows the
  // user across devices, not just from the local cache. Best-effort: if the fetch
  // fails (e.g. offline) we keep the cached/default value. getAccount() also
  // refreshes the localStorage cache via setSortPref internally.
  useEffect(() => {
    getAccount()
      .then((acc) => {
        if (!userChoseSort.current) setSortBy(acc.sortBy)
      })
      .catch(() => {})
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

  const changeSort = (field: SortField) => {
    userChoseSort.current = true
    setSortBy(field)
    setSortPref(field) // optimistic local cache
    // Best-effort server sync; if it fails (offline) the change stays local
    // and re-syncs on the next successful save.
    savePreferences(field).catch(() => {})
  }

  const stamp = (n: Note) => (sortBy === 'modified' ? n.updated_at : n.created_at)
  const filtered = [...filterByTags(filterNotes(notes, query), selected, untaggedOnly)].sort(
    (a, b) => new Date(stamp(b)).getTime() - new Date(stamp(a)).getTime(),
  )
  const searching = query.trim().length > 0

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {!isOfflineReadOnly() && (
        <Editor submitLabel={t('editor.fileIt')} onSubmit={handleCreate} resetOnSuccess />
      )}

      <div className="section-head">
        <span className="section-label">{t('home.recentEntries')}</span>
        <div className="sort-toggle" role="group" aria-label={t('home.sortLabel')}>
          <button
            type="button"
            className={sortBy === 'created' ? 'is-active' : ''}
            onClick={() => changeSort('created')}
          >
            {t('home.sortCreated')}
          </button>
          <button
            type="button"
            className={sortBy === 'modified' ? 'is-active' : ''}
            onClick={() => changeSort('modified')}
          >
            {t('home.sortModified')}
          </button>
        </div>
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
        <svg
          className="search-icon"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
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
                <div className="entry-date">{new Date(note.created_at).toLocaleDateString()}</div>
                <div className="entry-time">
                  {new Date(note.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
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
