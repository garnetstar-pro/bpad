import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { createNote } from './api'
import { buildSharedNote } from './shareTarget'
import { useTranslation, translate } from './i18n'

// Handles the Android share sheet (manifest share_target → GET /share).
// The mobile counterpart of Capture: same "one move, no typing" idea, except
// the payload arrives as query parameters instead of in the path.
//
// Saving straight away is deliberate — speed is the whole reason the feature
// exists, and the note lands open in the detail view for editing.
//
// This route needs no special handling for a locked vault: App renders the
// lock screen in place, keeping the URL, so the share survives the unlock.
export default function ShareTarget() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  const shared = buildSharedNote({
    title: params.get('title'),
    text: params.get('text'),
    url: params.get('url'),
  })

  useEffect(() => {
    if (!shared || ran.current) return
    ran.current = true // StrictMode / rerender must not file it twice
    createNote(shared.content)
      .then((note) => navigate(`/notes/${note.id}`, { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : translate('share.failed')))
  }, [shared, navigate])

  // An empty share (or someone opening /share by hand) has nothing to file.
  if (!shared) return <Navigate to="/" replace />

  return (
    <div className="detail-page">
      {error ? (
        <div className="error-banner">
          {error} <Link to="/">{t('capture.home')}</Link>
        </div>
      ) : (
        <div className="empty-state">{t('share.saving')}</div>
      )}
    </div>
  )
}
