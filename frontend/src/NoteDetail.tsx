import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Note } from './types'
import { getNote, updateNote, deleteNote } from './api'
import { contentWithoutTitleHeading } from './noteContent'
import { markdownComponents } from './markdown'
import { isOfflineReadOnly } from './session'
import Editor from './Editor'

function NoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [note, setNote] = useState<Note | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    getNote(id)
      .then((n) => active && setNote(n))
      .catch(() => active && setError('Poznámka nenalezena.'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id])

  const handleUpdate = async (content: string, title?: string) => {
    if (!id) return
    const updated = await updateNote(id, content, title)
    setNote(updated)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!id || !window.confirm('Opravdu smazat tuto poznámku?')) return
    try {
      setDeleting(true)
      await deleteNote(id)
      navigate('/')
    } catch {
      setError('Smazání se nepovedlo. Zkus to znovu.')
      setDeleting(false)
    }
  }

  if (loading) return <div className="detail-page"><div className="empty-state">loading…</div></div>
  if (error || !note) {
    return (
      <div className="detail-page">
        <div className="error-banner">{error ?? 'Poznámka nenalezena.'}</div>
        <Link className="back-link" to="/">‹ zpět na seznam</Link>
      </div>
    )
  }

  return (
    <div className="detail-page">
      <Link className="back-link" to="/">‹ zpět na seznam</Link>

      {editing ? (
        <Editor
          submitLabel="Save"
          onSubmit={handleUpdate}
          initialContent={note.content}
          initialTitle={note.title}
          editableTitle
          onCancel={() => setEditing(false)}
        />
      ) : (
        <article className="note-detail">
          <div className="note-detail-stamp">
            {new Date(note.created_at).toLocaleString()}
          </div>
          <h1 className="note-detail-title">{note.title}</h1>
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {contentWithoutTitleHeading(note.content, note.title)}
            </ReactMarkdown>
          </div>
          {!isOfflineReadOnly() && (
          <div className="note-detail-actions">
            <button className="save-btn" onClick={() => setEditing(true)} type="button">
              Edit
            </button>
            <button
              className="ghost-btn danger"
              onClick={handleDelete}
              disabled={deleting}
              type="button"
            >
              {deleting ? 'deleting…' : 'Delete'}
            </button>
          </div>
          )}
        </article>
      )}
    </div>
  )
}

export default NoteDetail
