import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Navigate, Link } from 'react-router-dom'
import { createNote } from './api'
import { extractUrl } from './captureUrl'

// Zachytí odkaz z adresy (dev.bpad.pro/https://test.cz), uloží ho jako novou
// poznámku (URL = obsah i nadpis, editovatelný) a přesměruje na její detail.
// Nejde-li o URL, spadne na domovskou stránku.
export default function Capture() {
  const location = useLocation()
  const navigate = useNavigate()
  const url = extractUrl(location)
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (!url || ran.current) return
    ran.current = true // StrictMode / rerender nesmí uložit dvakrát
    createNote(url)
      .then((note) => navigate(`/notes/${note.id}`, { replace: true }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Uložení odkazu selhalo'))
  }, [url, navigate])

  if (!url) return <Navigate to="/" replace />

  return (
    <div className="detail-page">
      {error ? (
        <div className="error-banner">
          {error} <Link to="/">← domů</Link>
        </div>
      ) : (
        <div className="empty-state">ukládám odkaz…</div>
      )}
    </div>
  )
}
