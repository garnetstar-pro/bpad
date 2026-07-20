import { useTranslation } from './i18n'

// Right-pane filler on desktop when no note is open. Hidden on mobile via CSS.
export default function DetailPlaceholder() {
  const { t } = useTranslation()
  return <div className="detail-placeholder">{t('notes.selectPrompt')}</div>
}
