import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdown'
import { canAutofocus } from './device'
import { useTranslation } from './i18n'

// Config: how many rows the textarea grows to with content.
// Past this limit the height is fixed and a scrollbar appears.
const MAX_TEXTAREA_ROWS = 12

interface EditorProps {
  submitLabel: string
  onSubmit: (content: string, title?: string) => Promise<void>
  initialContent?: string
  // Show an editable title field (for editing); for a new note the title
  // is derived from the markdown automatically, so the field isn't needed.
  editableTitle?: boolean
  initialTitle?: string
  // Clear the editor after a successful save (for a new note); not for editing.
  resetOnSuccess?: boolean
  onCancel?: () => void
}

function Editor({
  submitLabel,
  onSubmit,
  initialContent = '',
  editableTitle = false,
  initialTitle = '',
  resetOnSuccess = false,
  onCancel,
}: EditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialContent)
  const [title, setTitle] = useState(initialTitle)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Focus the textarea (only on desktop – on mobile it would pop up the keyboard).
  useEffect(() => {
    if (!submitting && mode === 'write' && canAutofocus()) textareaRef.current?.focus()
  }, [submitting, mode])

  // Fit the textarea height to its content (grows up to MAX_TEXTAREA_ROWS, then scrollbar)
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

  useEffect(() => {
    autoResize()
  }, [draft, mode])

  const submit = async () => {
    if (!draft.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(draft, editableTitle ? title : undefined)
      if (resetOnSuccess) {
        setDraft('')
        setTitle('')
        setMode('write')
      }
    } catch (err) {
      // Show the server message (e.g. the limit for an unverified account) verbatim.
      setError(err instanceof Error ? err.message : t('editor.saveFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // Ctrl+Enter (or Cmd+Enter on Mac) saves from any field in the form;
  // plain Enter makes a new line in the textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="capture" onKeyDown={handleKeyDown}>
      {error && <div className="error-banner">{error}</div>}

      {editableTitle && (
        <div className="title-field">
          <label className="title-label" htmlFor="note-title">{t('editor.title')}</label>
          <input
            id="note-title"
            className="title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('editor.titlePlaceholder')}
            disabled={submitting}
          />
        </div>
      )}

      <div className="capture-tabs">
        <button
          className={`capture-tab ${mode === 'write' ? 'is-active' : ''}`}
          onClick={() => setMode('write')}
          type="button"
        >
          {t('editor.write')}
        </button>
        <button
          className={`capture-tab ${mode === 'preview' ? 'is-active' : ''}`}
          onClick={() => setMode('preview')}
          type="button"
        >
          {t('editor.preview')}
        </button>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('editor.bodyPlaceholder')}
          disabled={submitting}
        />
      ) : (
        <div className="capture-preview markdown-body">
          {draft.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{draft}</ReactMarkdown>
          ) : (
            <div className="empty-state">{t('editor.nothingToPreview')}</div>
          )}
        </div>
      )}

      <div className="capture-footer">
        <span className="capture-hint">
          {submitting ? t('editor.saving') : t('editor.saveHint', { label: submitLabel })}
        </span>
        <div className="capture-actions">
          {onCancel && (
            <button className="ghost-btn" onClick={onCancel} disabled={submitting} type="button">
              {t('common.cancel')}
            </button>
          )}
          <button className="save-btn" onClick={submit} disabled={submitting} type="button">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Editor
