import { useTranslation } from './i18n'

// Presentational filter bar: a chip per known tag plus an "untagged" chip.
export function TagBar({
  tags,
  selected,
  untaggedOnly,
  onToggleTag,
  onToggleUntagged,
}: {
  tags: string[]
  selected: string[]
  untaggedOnly: boolean
  onToggleTag: (tag: string) => void
  onToggleUntagged: () => void
}) {
  const { t } = useTranslation()
  if (tags.length === 0) return null
  return (
    <div className="tag-bar">
      <button
        type="button"
        className={`tag-bar-chip ${untaggedOnly ? 'is-active' : ''}`}
        onClick={onToggleUntagged}
      >
        {t('tags.untagged')}
      </button>
      {tags.map((tag) => (
        <button
          type="button"
          key={tag}
          className={`tag-bar-chip ${selected.includes(tag) ? 'is-active' : ''}`}
          onClick={() => onToggleTag(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  )
}
