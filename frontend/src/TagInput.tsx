import { useRef, useState } from 'react'
import { useTranslation } from './i18n'
import { normalizeTag } from './tags'

// Chip input with prefix autocomplete. A tag is committed when a space or
// comma is typed, on Enter, or on blur (tapping Save/away) — the input-based
// paths are what make it work on mobile keyboards, where keydown for
// Enter/space isn't reliable. Backspace on an empty field removes the last chip.
export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const skipBlur = useRef(false)

  const commit = (raw: string) => {
    const tag = normalizeTag(raw)
    if (tag && !value.includes(tag)) onChange([...value, tag])
  }

  // Commit whenever a delimiter (space/comma) appears; keep any trailing
  // partial in the field. Reliable across mobile keyboards / IME.
  const handleChange = (v: string) => {
    if (!/[ ,]/.test(v)) {
      setInput(v)
      return
    }
    const parts = v.split(/[ ,]+/)
    const remainder = parts.pop() ?? ''
    const next = [...value]
    for (const p of parts) {
      const tag = normalizeTag(p)
      if (tag && !next.includes(tag)) next.push(tag)
    }
    if (next.length !== value.length) onChange(next)
    setInput(remainder)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (input.trim()) {
        e.preventDefault()
        commit(input)
        setInput('')
      }
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const onBlur = () => {
    if (skipBlur.current) {
      skipBlur.current = false
      return
    }
    if (input.trim()) {
      commit(input)
      setInput('')
    }
  }

  const q = normalizeTag(input)
  const matches = q
    ? suggestions.filter((s) => s.startsWith(q) && !value.includes(s)).slice(0, 6)
    : []

  return (
    <div className="tag-input">
      <div className="tag-chips">
        {value.map((tag, i) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              className="tag-chip-x"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={t('tags.remove')}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="tag-field"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={value.length ? '' : t('tags.placeholder')}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          enterKeyHint="done"
        />
      </div>
      {matches.length > 0 && (
        <div className="tag-suggest">
          {matches.map((s) => (
            <button
              type="button"
              className="tag-suggest-item"
              key={s}
              // onMouseDown (not onClick) + skipBlur so selecting a suggestion
              // doesn't first blur-commit the partial input.
              onMouseDown={(e) => {
                e.preventDefault()
                skipBlur.current = true
                commit(s)
                setInput('')
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
