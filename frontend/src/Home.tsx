import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router-dom'
import type { Note } from './types'
import { getKnownTags, listNotes, listNotesCached, createNote } from './api'
import { filterNotes } from './search'
import { filterByTags, normalizeTag } from './tags'
import { isOfflineReadOnly } from './session'
import Editor from './Editor'
import { TagBar } from './TagBar'
import { TagPills } from './TagPills'
import { useTranslation, translate } from './i18n'
import { getSortPref, setSortPref, type SortField } from './preferences'
import { savePreferences, getAccount } from './authApi'
import { useWideLayout } from './device'
import { shouldAutoOpenTop } from './noteSelection'

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
  const navigate = useNavigate()
  const wide = useWideLayout()
  // The note open in the detail pane, so its row can be marked active.
  const activeId = useMatch('/notes/:id')?.params.id
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

  // Set once the server has answered, so a slow cache read can never overwrite
  // fresh notes with stale ones.
  const servedFromNetwork = useRef(false)
  // True while a server fetch is outstanding. Guards the auto-open effect below
  // so a note just created in the detail pane isn't clobbered before its refetch
  // lands (it isn't in `notes` yet, which would otherwise read as invalid).
  const refetching = useRef(false)

  // Pull the authoritative list from the server. Extracted from the mount
  // effect so the mutation listener below can reuse it — in the two-pane
  // layout this list stays mounted while the detail pane edits notes.
  const fetchNotes = useCallback(async () => {
    refetching.current = true
    try {
      const fresh = await listNotes()
      servedFromNetwork.current = true
      setNotes(fresh)
      setError(null)
    } catch {
      setError(translate('home.connectFailed'))
    } finally {
      refetching.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    // Paint the cached notes first. The server response carries the full
    // ciphertext of every note (~700 KiB at 250 notes), so waiting for it left
    // the list empty for seconds right after unlocking.
    listNotesCached().then((cached) => {
      // The network may have won the race — never overwrite fresh with stale.
      if (cancelled || servedFromNetwork.current || !cached) return
      setNotes(cached)
      setLoading(false)
    })

    fetchNotes()

    return () => {
      cancelled = true
    }
  }, [fetchNotes])

  // Keep the persistent list pane in sync when the detail pane mutates a note.
  useEffect(() => {
    const refetch = () => { fetchNotes() }
    window.addEventListener('bpad:notes-mutated', refetch)
    return () => window.removeEventListener('bpad:notes-mutated', refetch)
  }, [fetchNotes])

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

  // Desktop two-pane: keep a note open in the detail pane. When nothing valid is
  // selected — the URL is `/`, or the open note was just deleted — open the one
  // at the top of the current list. Re-checks after refetches, so deleting the
  // open note reveals the next top note rather than an empty pane. Mobile is
  // untouched: `/` stays on the list.
  const topId = filtered[0]?.id
  useEffect(() => {
    if (
      !shouldAutoOpenTop({
        wide,
        loading,
        refetching: refetching.current,
        topId,
        activeId,
        noteIds: notes.map((n) => n.id),
      })
    )
      return
    navigate(`/notes/${topId}`, { replace: true })
  }, [wide, loading, topId, activeId, notes, navigate])

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      {/* Mobile keeps the composer pinned at the top of the list. On desktop it
          moves to the right pane (NotesLayout) so the list starts with the
          entries. */}
      {!wide && !isOfflineReadOnly() && (
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
          <div className={`entry ${note.id === activeId ? 'is-active' : ''}`} key={note.id}>
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
