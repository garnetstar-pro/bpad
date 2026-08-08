import type { Note } from './types'
import { useTranslation } from './i18n'

// Note metadata below the note card — created, and modified when it differs.
// Desktop-only (hidden via CSS on mobile), read mode with a loaded note only.
// The app-wide links that used to sit here now live in AppFooter, which every
// page gets.
export default function DetailFooter({ note }: { note: Note }) {
  const { t } = useTranslation()
  const created = new Date(note.created_at).toLocaleString()
  const updated = new Date(note.updated_at).toLocaleString()
  const showUpdated = note.updated_at !== note.created_at

  return (
    <footer className="detail-footer">
      <div className="detail-footer-meta">
        <span>{t('notes.metaCreated', { date: created })}</span>
        {showUpdated && <span>{t('notes.metaUpdated', { date: updated })}</span>}
      </div>
    </footer>
  )
}
