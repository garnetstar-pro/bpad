import { Link } from 'react-router-dom'
import type { Note } from './types'
import { useTranslation } from './i18n'

// Footer below the note card, desktop-only (hidden via CSS on mobile). Two rows:
// note metadata (created, and modified when it differs), then a static app
// footer. Rendered only in read mode with a loaded note.
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
      <div className="detail-footer-app">
        <Link to="/features" className="detail-footer-link">{t('footer.features')}</Link>
        <span className="detail-footer-tagline">{t('footer.tagline')}</span>
        <span className="detail-footer-copy">{t('footer.copyright')}</span>
      </div>
    </footer>
  )
}
