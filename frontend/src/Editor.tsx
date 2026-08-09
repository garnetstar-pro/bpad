import { useState, useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { markdownComponents, markdownPlugins, bpadUrlTransform } from './markdown'
import { canAutofocus } from './device'
import { useTranslation } from './i18n'
import { TagInput } from './TagInput'
import { getKnownTags } from './api'
import { isPremium } from './entitlements'
import { FREE_TAG_LIMIT, distinctTagCount } from './tags'
import { processImage, uploadImage } from './images'
import { parseImageIds } from './imageRefs'
import { getMaxImagesPerNote } from './entitlements'
import { insertAt } from './textInsert'
import { KeyHint } from './KeyHint'
import { getDataKey, getUsername } from './session'
import {
  saveDraft,
  loadDraft,
  clearDraft,
  pruneDrafts,
  isRestorable,
  type Draft,
} from './draftStore'

// Config: how many rows the textarea grows to with content.
// Past this limit the height is fixed and a scrollbar appears.
const MAX_TEXTAREA_ROWS = 12

// How long the typing has to pause before the draft is sealed to localStorage.
// Short enough that an interruption costs at most a sentence, long enough that
// a fast typist isn't running Argon2-grade crypto on every keystroke (this is
// a cheap AES-GCM seal, but the write itself is synchronous).
const AUTOSAVE_DELAY_MS = 600

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
  // Where to keep an unsaved draft (see draftStore.ts). Omitted = no
  // persistence, which is what the tests and any throwaway editor want.
  draftSlot?: string
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
  draftSlot,
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

  // --- Unsaved-draft persistence (draftStore.ts) --------------------------
  // True once a recovered draft has been put back, so the banner can offer to
  // undo it — a restore the user didn't expect must never be a one-way door.
  const [restored, setRestored] = useState(false)
  // Gates the autosave below until the restore attempt has finished. Without
  // it a slow decrypt loses the race against the first autosave pass, which
  // sees a still-empty editor and deletes the very draft being loaded.
  const [restoreChecked, setRestoreChecked] = useState(false)
  // What the editor started with. A draft is only worth keeping (or restoring)
  // when it differs from this. Held in a ref so a save can move the goalposts
  // without re-running the autosave effect.
  const baseline = useRef<Draft>({
    content: initialContent,
    title: editableTitle ? initialTitle : undefined,
    tags: initialTags,
  })
  // Set as soon as the user edits anything, so a slow restore never lands on
  // top of text they have already started typing.
  const edited = useRef(false)
  // A change is waiting for the debounce to flush it. Only then is closing the
  // tab actually lossy, so only then is the browser's "leave site?" warranted.
  const unflushed = useRef(false)

  const current = (): Draft => ({
    content: draft,
    title: editableTitle ? title : undefined,
    tags,
  })
  // Same predicate in both directions: a draft worth restoring later is
  // exactly a draft worth storing now — non-blank, and different from what the
  // editor opened with.
  const isDirty = (d: Draft) => isRestorable(d, baseline.current)

  // Per-account quota, enforced here so an over-limit upload never starts; the
  // API rejects one anyway (403), which is the backstop for a stale cache.
  const imageLimit = getMaxImagesPerNote()
  const atImageLimit = useMemo(
    () => parseImageIds(draft).length >= imageLimit,
    [draft, imageLimit],
  )

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

  // Put back whatever the last session left behind. Runs once per slot: the
  // idle lock unmounts the whole app (App.tsx renders LockScreen instead of
  // the routes), so after unlocking this is the only thing standing between
  // the user and a lost paragraph.
  useEffect(() => {
    if (!draftSlot) return
    pruneDrafts()
    const username = getUsername()
    const key = getDataKey()
    if (!username || !key) return setRestoreChecked(true)
    let cancelled = false
    void loadDraft(username, key, draftSlot).then((stored) => {
      if (cancelled) return
      if (!edited.current && isRestorable(stored, baseline.current)) {
        setDraft(stored!.content)
        if (editableTitle) setTitle(stored!.title ?? '')
        setTags(stored!.tags)
        setRestored(true)
      }
      setRestoreChecked(true)
    })
    return () => {
      cancelled = true
    }
    // editableTitle is fixed per call site; the slot is what identifies the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSlot])

  // Seal the draft after a pause in typing. Clearing on a clean editor matters
  // as much as saving on a dirty one: undoing back to the original text has to
  // drop the stored draft too, or it would resurrect on the next visit.
  useEffect(() => {
    if (!draftSlot || !restoreChecked) return
    const username = getUsername()
    const key = getDataKey()
    if (!username || !key) return
    const snapshot = current()
    const dirty = isDirty(snapshot)
    unflushed.current = dirty
    const timer = setTimeout(() => {
      if (dirty) {
        void saveDraft(username, key, draftSlot, snapshot).then(() => {
          unflushed.current = false
        })
      } else {
        clearDraft(username, draftSlot)
        unflushed.current = false
      }
    }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, title, tags, draftSlot, restoreChecked])

  // Only warn about closing the tab while a change hasn't reached storage yet.
  // Nagging on every close would train the user to click through it.
  useEffect(() => {
    if (!draftSlot) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!unflushed.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftSlot])

  // Throw away a restore the user didn't want, and the stored draft with it.
  const discardRestored = () => {
    const username = getUsername()
    if (username && draftSlot) clearDraft(username, draftSlot)
    setDraft(baseline.current.content)
    setTitle(baseline.current.title ?? '')
    setTags(baseline.current.tags)
    setRestored(false)
    unflushed.current = false
  }

  const submit = async () => {
    // uploading blocks the save the way it already blocks the Save button: the
    // textarea stays focused during an upload now, so Ctrl+Enter could otherwise
    // save a draft that the image snippet has not reached yet, dropping it.
    if (!draft.trim() || submitting || uploading) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(draft, editableTitle ? title : undefined, tags)
      // Saved text is no longer a draft. Moving the baseline matters for the
      // editing path, where the editor keeps the content on screen: without it
      // the just-saved note would still read as "unsaved changes" forever.
      baseline.current = resetOnSuccess ? { content: '', title: undefined, tags: [] } : current()
      const username = getUsername()
      if (username && draftSlot) clearDraft(username, draftSlot)
      unflushed.current = false
      setRestored(false)
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
    // Escape backs out of the editor. Handled here rather than by the global
    // shortcut so it works from inside the fields too — and the draft survives,
    // because cancelling never clears it (see draftStore.ts).
    if (e.key === 'Escape' && onCancel && !submitting) {
      e.preventDefault()
      onCancel()
    }
  }

  // Upload an image and insert ![](bpad-img:ID) at the caret. Shared by the paste
  // handler (desktop) and the "Add image" file picker (mobile + desktop).
  const insertImageFromFile = async (file: File | Blob) => {
    // Covers the paste path too, where a disabled button is no help.
    if (atImageLimit) {
      setError(t('editor.imageLimit', { limit: imageLimit }))
      return
    }
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

      {restored && (
        <div className="draft-banner">
          <span>{t('editor.draftRestored')}</span>
          <button type="button" className="draft-discard" onClick={discardRestored}>
            {t('editor.draftDiscard')}
          </button>
        </div>
      )}

      {editableTitle && (
        <div className="title-field">
          <label className="title-label" htmlFor="note-title">{t('editor.title')}</label>
          <input
            id="note-title"
            className="title-input"
            type="text"
            value={title}
            onChange={(e) => {
              edited.current = true
              setTitle(e.target.value)
            }}
            placeholder={t('editor.titlePlaceholder')}
            disabled={submitting}
          />
        </div>
      )}

      <TagInput
        value={tags}
        onChange={(next) => {
          edited.current = true
          setTags(next)
        }}
        suggestions={getKnownTags()}
      />
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
          disabled={submitting || uploading || atImageLimit}
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
          onChange={(e) => {
            edited.current = true
            setDraft(e.target.value)
          }}
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
          {uploading ? (
            t('editor.imageUploading')
          ) : submitting ? (
            t('editor.saving')
          ) : (
            <>
              <KeyHint keys="Ctrl/⌘ + Enter" /> {t('editor.saveHint', { label: submitLabel })}
              {onCancel && (
                <>
                  {' · '}
                  <KeyHint keys="Esc" /> {t('editor.cancelHint')}
                </>
              )}
            </>
          )}
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
