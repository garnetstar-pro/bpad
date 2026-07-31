import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownComponents, markdownPlugins, bpadUrlTransform } from './markdown'
import { canAutofocus } from './device'
import { useTranslation } from './i18n'
import { TagInput } from './TagInput'
import { getKnownTags } from './api'
import { isPremium } from './entitlements'
import { FREE_TAG_LIMIT, distinctTagCount } from './tags'
import { processImage, uploadImage } from './images'
import { insertAt } from './textInsert'

// Config: how many rows the textarea grows to with content.
// Past this limit the height is fixed and a scrollbar appears.
const MAX_TEXTAREA_ROWS = 12

interface EditorProps {
  submitLabel: string
  onSubmit: (content: string, title?: string, tags?: string[]) => Promise<void>
  initialContent?: string
  // Show an editable title field (for editing); for a new note the title
  // is derived from the markdown automatically, so the field isn't needed.
  editableTitle?: boolean
  initialTitle?: string
  // Clear the editor after a successful save (for a new note); not for editing.
  resetOnSuccess?: boolean
  onCancel?: () => void
  initialTags?: string[]
}

function Editor({
  submitLabel,
  onSubmit,
  initialContent = '',
  editableTitle = false,
  initialTitle = '',
  resetOnSuccess = false,
  onCancel,
  initialTags = [],
}: EditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialContent)
  const [title, setTitle] = useState(initialTitle)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Where the caret belongs once an inserted image lands in the draft.
  const pendingCaret = useRef<number | null>(null)

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

  // Put the caret back after an inserted image. The upload is async, so by the
  // time the snippet reaches the draft the textarea may not be focused any
  // more: the "Add image" picker takes focus, and the caret would otherwise sit
  // wherever the re-render left it (the end of the text). Ctrl+Enter is handled
  // on the wrapper div, so losing focus silently breaks saving from the
  // keyboard — which is exactly what a paste used to do.
  //
  // The ref is only cleared once it is applied: with the picker used from the
  // preview tab there is no textarea yet, and the caret is placed when the user
  // switches back to Write.
  useEffect(() => {
    const caret = pendingCaret.current
    if (caret === null) return
    const ta = textareaRef.current
    if (!ta) return
    pendingCaret.current = null
    // Focusing on mobile would pop the keyboard up over the note, the same
    // reason the initial autofocus is desktop-only.
    if (canAutofocus()) ta.focus()
    ta.setSelectionRange(caret, caret)
  }, [draft, mode])

  const submit = async () => {
    // uploading blocks the save the way it already blocks the Save button: the
    // textarea stays focused during an upload now, so Ctrl+Enter could otherwise
    // save a draft that the image snippet has not reached yet, dropping it.
    if (!draft.trim() || submitting || uploading) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(draft, editableTitle ? title : undefined, tags)
      if (resetOnSuccess) {
        setDraft('')
        setTitle('')
        setTags([])
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

  // Upload an image and insert ![](bpad-img:ID) at the caret. Shared by the paste
  // handler (desktop) and the "Add image" file picker (mobile + desktop).
  const insertImageFromFile = async (file: File | Blob) => {
    const ta = textareaRef.current
    const start = ta ? ta.selectionStart : draft.length
    const end = ta ? ta.selectionEnd : draft.length
    setUploading(true)
    setError(null)
    try {
      const processed = await processImage(file)
      const id = await uploadImage(processed)
      const snippet = `![](bpad-img:${id})`
      setDraft((d) => {
        const next = insertAt(d, start, end, snippet)
        // Written from the updater so it follows the same clamped bounds as the
        // text. Idempotent, so StrictMode's double-invoke is harmless.
        pendingCaret.current = next.caret
        return next.text
      })
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(code === 'too-large' ? t('editor.imageTooLarge') : t('editor.imageFailed'))
    } finally {
      setUploading(false)
    }
  }

  // Paste an image (clipboard clipping) → upload → insert at the caret.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return // let normal text paste through
    e.preventDefault()
    const file = item.getAsFile()
    if (file) insertImageFromFile(file)
  }

  // Pick an image from the device (photo library / screenshots / camera). No
  // `capture` attribute on purpose, so the OS offers the library, not only the
  // camera. Reset the value so re-picking the same file fires `change` again.
  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) insertImageFromFile(file)
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

      <TagInput value={tags} onChange={setTags} suggestions={getKnownTags()} />
      {!isPremium() && distinctTagCount(getKnownTags(), tags) > FREE_TAG_LIMIT && (
        <div className="tag-nudge">{t('tags.overLimit', { count: distinctTagCount(getKnownTags(), tags), limit: FREE_TAG_LIMIT })}</div>
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
        <button
          className="capture-tab add-image-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={submitting || uploading}
          type="button"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          {t('editor.addImage')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFilePick}
          style={{ display: 'none' }}
        />
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={handlePaste}
          placeholder={t('editor.bodyPlaceholder')}
          disabled={submitting}
          // readOnly, not disabled, while an image uploads: disabling a focused
          // element blurs it, and nothing would bring the focus back — Ctrl+Enter
          // then stops saving because the handler sits on the wrapper div. The
          // footer hint carries the "uploading" cue either way.
          readOnly={uploading}
        />
      ) : (
        <div className="capture-preview markdown-body">
          {draft.trim() ? (
            <ReactMarkdown remarkPlugins={markdownPlugins} components={markdownComponents} urlTransform={bpadUrlTransform}>{draft}</ReactMarkdown>
          ) : (
            <div className="empty-state">{t('editor.nothingToPreview')}</div>
          )}
        </div>
      )}

      <div className="capture-footer">
        <span className="capture-hint">
          {uploading
            ? t('editor.imageUploading')
            : submitting
              ? t('editor.saving')
              : t('editor.saveHint', { label: submitLabel })}
        </span>
        <div className="capture-actions">
          {onCancel && (
            <button className="ghost-btn" onClick={onCancel} disabled={submitting} type="button">
              {t('common.cancel')}
            </button>
          )}
          <button className="save-btn" onClick={submit} disabled={submitting || uploading} type="button">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Editor
