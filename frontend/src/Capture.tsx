import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Navigate, Link } from 'react-router-dom'
import { createNote } from './api'
import { extractUrl } from './captureUrl'
import { useTranslation, translate } from './i18n'

// Captures a link from the address (dev.bpad.pro/https://test.cz), saves it
// as a new note (URL = both content and title, editable) and redirects to
// its detail. If it's not a URL, falls back to the home page.
export default function Capture() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const url = extractUrl(location)
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (!url || ran.current) return
    ran.current = true // StrictMode / rerender must not save twice
    createNote(url)
      .then((note) => navigate(`/notes/${note.id}`, { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : translate('capture.failed')))
  }, [url, navigate])

  if (!url) return <Navigate to="/" replace />

  return (
    <div className="detail-page">
      {error ? (
        <div className="error-banner">
          {error} <Link to="/">{t('capture.home')}</Link>
        </div>
      ) : (
        <div className="empty-state">{t('capture.saving')}</div>
      )}
    </div>
  )
}
