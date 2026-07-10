import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Konfigurace: do kolika řádků textarea poroste s obsahem.
// Po překročení tohoto limitu se výška zafixuje a objeví se posuvník.
const MAX_TEXTAREA_ROWS = 12

interface EditorProps {
  submitLabel: string
  onSubmit: (content: string) => Promise<void>
  initialContent?: string
  // Po úspěšném uložení vyprázdnit editor (pro novou poznámku); u editace ne.
  resetOnSuccess?: boolean
  onCancel?: () => void
}

function Editor({
  submitLabel,
  onSubmit,
  initialContent = '',
  resetOnSuccess = false,
  onCancel,
}: EditorProps) {
  const [draft, setDraft] = useState(initialContent)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Fokus do textarey při otevření a po návratu z náhledu / po uložení
  useEffect(() => {
    if (!submitting && mode === 'write') textareaRef.current?.focus()
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
      await onSubmit(draft)
      if (resetOnSuccess) {
        setDraft('')
        setMode('write')
      }
    } catch {
      setError('Uložení se nepovedlo. Zkus to znovu.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter (nebo Cmd+Enter na Macu) uloží; samotný Enter dělá nový řádek
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="capture">
      {error && <div className="error-banner">{error}</div>}

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
          onKeyDown={handleKeyDown}
          placeholder="Write a thought or paste a link…"
          disabled={submitting}
        />
      ) : (
        <div className="capture-preview markdown-body">
          {draft.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
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
