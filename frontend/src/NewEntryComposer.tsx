import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Editor from './Editor'
import { createNote, getKnownNoteCount } from './api'
import { shouldStartExpanded } from './composer'
import { useTranslation } from './i18n'

// Desktop-only new-entry composer, pinned above the note detail in the right
// pane. Collapsed to a slim bar by default; clicking it expands the full Editor.
// Explicit toggle only — clicking elsewhere or switching notes never collapses
// it. Filing an entry collapses the bar and opens the just-created note below.
export default function NewEntryComposer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => shouldStartExpanded(getKnownNoteCount()))
  // Once the user opens or closes the bar themselves, stop letting the note
  // count drive the initial-expanded rule (below).
  const userToggled = useRef(false)

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
      <Editor submitLabel={t('editor.fileIt')} onSubmit={handleCreate} onCancel={collapse} />
    </div>
  )
}
