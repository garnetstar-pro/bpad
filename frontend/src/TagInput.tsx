import { useState } from 'react'
import { useTranslation } from './i18n'
import { normalizeTag } from './tags'

// Chip input with prefix autocomplete from `suggestions`. Enter / comma /
// space commit a chip (single-word); Backspace on empty removes the last.
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

  const add = (raw: string) => {
    const tag = normalizeTag(raw)
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setInput('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      if (input.trim()) {
        e.preventDefault()
        add(input)
      }
    } else if (e.key === 'Backspace' && !input && value.length) {
      onChange(value.slice(0, -1))
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
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? '' : t('tags.placeholder')}
        />
      </div>
      {matches.length > 0 && (
        <div className="tag-suggest">
          {matches.map((s) => (
            <button
              type="button"
              className="tag-suggest-item"
              key={s}
              // onMouseDown (not onClick) so the input doesn't blur first.
              onMouseDown={(e) => {
                e.preventDefault()
                add(s)
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
