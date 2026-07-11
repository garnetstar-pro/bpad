import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from './markdown'
import { canAutofocus } from './device'

// Konfigurace: do kolika řádků textarea poroste s obsahem.
// Po překročení tohoto limitu se výška zafixuje a objeví se posuvník.
const MAX_TEXTAREA_ROWS = 12

interface EditorProps {
  submitLabel: string
  onSubmit: (content: string, title?: string) => Promise<void>
  initialContent?: string
  // Zobrazit editovatelné pole názvu (pro editaci); u nové poznámky se název
  // odvodí z markdownu automaticky, takže pole není potřeba.
  editableTitle?: boolean
  initialTitle?: string
  // Po úspěšném uložení vyprázdnit editor (pro novou poznámku); u editace ne.
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
  const [draft, setDraft] = useState(initialContent)
  const [title, setTitle] = useState(initialTitle)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fokus do textarey (jen na počítači – na mobilu by vyskočila klávesnice).
  useEffect(() => {
    if (!submitting && mode === 'write' && canAutofocus()) textareaRef.current?.focus()
  }, [submitting, mode])

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
    } catch {
      setError('Uložení se nepovedlo. Zkus to znovu.')
    } finally {
      setSubmitting(false)
    }
  }

  // Ctrl+Enter (nebo Cmd+Enter na Macu) uloží z kteréhokoli pole formuláře;
  // samotný Enter dělá v textarei nový řádek
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
          <label className="title-label" htmlFor="note-title">title</label>
          <input
            id="note-title"
            className="title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="odvodí se z markdownu, když necháš prázdné"
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
          placeholder="Write a thought or paste a link…"
          disabled={submitting}
        />
      ) : (
        <div className="capture-preview markdown-body">
          {draft.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{draft}</ReactMarkdown>
          ) : (
            <div className="empty-state">nothing to preview</div>
          )}
        </div>
      )}

      <div className="capture-footer">
        <span className="capture-hint">
          {submitting ? 'saving…' : `ctrl+enter or click “${submitLabel}”`}
        </span>
        <div className="capture-actions">
          {onCancel && (
            <button className="ghost-btn" onClick={onCancel} disabled={submitting} type="button">
              Cancel
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
