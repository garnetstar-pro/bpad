import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Editor from './Editor'
import { createNote, getKnownNoteCount } from './api'
import { shouldStartExpanded } from './composer'
import { useTranslation } from './i18n'
import { NEW_NOTE_SLOT } from './draftStore'

// Desktop-only new-entry composer, pinned above the note detail in the right
// pane. Collapsed to a slim bar by default; clicking it expands the full Editor.
// Explicit toggle only — clicking elsewhere or switching notes never collapses
// it. Filing an entry collapses the bar and opens the just-created note below.
export default function NewEntryComposer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // The manifest shortcut (long-press the installed icon) lands on /?new=1 and
  // means exactly one thing: open the composer. Mobile needs no equivalent —
  // Home keeps the composer pinned above the list there.
  const [params] = useSearchParams()
  const openRequested = params.get('new') === '1'
  const [expanded, setExpanded] = useState(
    () => openRequested || shouldStartExpanded(getKnownNoteCount()),
  )
  // Once the user opens or closes the bar themselves, stop letting the note
  // count drive the initial-expanded rule (below). The shortcut counts as the
  // user having opened it, so an arriving note count can't snap it shut.
  const userToggled = useRef(openRequested)

  // An account that loads empty resolves its count from null → 0 after mount;
  // open the composer then, unless the user has already taken over.
  useEffect(() => {
    const sync = () => {
      if (!userToggled.current) setExpanded(shouldStartExpanded(getKnownNoteCount()))
    }
    window.addEventListener('bpad:notes-changed', sync)
    return () => window.removeEventListener('bpad:notes-changed', sync)
  }, [])

  const open = () => {
    userToggled.current = true
    setExpanded(true)
  }
  const collapse = () => {
    userToggled.current = true
    setExpanded(false)
  }

  const handleCreate = async (content: string, _title?: string, tags?: string[]) => {
    const note = await createNote(content, tags ?? [])
    // Only reached when the create succeeded — on failure Editor keeps the draft
    // and shows the error. Open the new entry below and collapse the bar.
    navigate(`/notes/${note.id}`)
    collapse()
  }

  if (!expanded) {
    return (
      <button type="button" className="composer-bar" onClick={open}>
        {t('composer.newEntry')}
      </button>
    )
  }

  return (
    <div className="composer-open">
      <Editor
        submitLabel={t('editor.fileIt')}
        onSubmit={handleCreate}
        onCancel={collapse}
        draftSlot={NEW_NOTE_SLOT}
      />
    </div>
  )
}
