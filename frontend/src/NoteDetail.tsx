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
import { useTranslation, translate } from './i18n'
import { TagPills } from './TagPills'

function NoteDetail() {
  const { t } = useTranslation()
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
      .catch(() => active && setError(translate('notes.notFound')))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [id])

  const handleUpdate = async (content: string, title?: string, tags?: string[]) => {
    if (!id) return
    const updated = await updateNote(id, content, title, tags ?? [])
    setNote(updated)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!id || !window.confirm(t('notes.deleteConfirm'))) return
    try {
      setDeleting(true)
      await deleteNote(id)
      navigate('/')
    } catch {
      setError(t('notes.deleteFailed'))
      setDeleting(false)
    }
  }

  if (loading) return <div className="detail-page"><div className="empty-state">{t('common.loading')}</div></div>
  if (error || !note) {
    return (
      <div className="detail-page">
        <div className="error-banner">{error ?? t('notes.notFound')}</div>
        <Link className="back-link" to="/">{t('notes.back')}</Link>
      </div>
    )
  }

  return (
    <div className="detail-page">
      <Link className="back-link" to="/">{t('notes.back')}</Link>

      {editing ? (
        <Editor
          submitLabel={t('notes.save')}
          onSubmit={handleUpdate}
          initialContent={note.content}
          initialTitle={note.title}
          initialTags={note.tags}
          editableTitle
          onCancel={() => setEditing(false)}
        />
      ) : (
        <article className="note-detail">
          <div className="note-detail-stamp">
            {new Date(note.created_at).toLocaleString()}
          </div>
          <h1 className="note-detail-title">{note.title}</h1>
          <TagPills tags={note.tags} />
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {contentWithoutTitleHeading(note.content, note.title)}
            </ReactMarkdown>
          </div>
          {!isOfflineReadOnly() && (
          <div className="note-detail-actions">
            <button className="save-btn" onClick={() => setEditing(true)} type="button">
              {t('notes.edit')}
            </button>
            <button
              className="ghost-btn danger"
              onClick={handleDelete}
              disabled={deleting}
              type="button"
            >
              {deleting ? t('notes.deleting') : t('notes.delete')}
            </button>
          </div>
          )}
        </article>
      )}
    </div>
  )
}

export default NoteDetail
