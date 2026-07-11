import { useState, useEffect } from 'react'
import BpadMark from './BpadMark'
import { verifyEmail } from './authApi'

// Stránka z ověřovacího odkazu v e-mailu (funguje i bez přihlášení).
export default function VerifyEmail() {
  const [status, setStatus] = useState<'busy' | 'ok' | 'error'>('busy')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const user = params.get('user')
    const token = params.get('token')
    if (!user || !token) {
      setStatus('error')
      return
    }
    verifyEmail(user, token)
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <div className="brand-wrap">
            <BpadMark size={34} />
            <div>
              <div className="brand-kicker">blank pad · encrypted</div>
              <div className="brand">bpad</div>
            </div>
          </div>
          <div className="brand-meta">verify</div>
        </div>

        <h2 className="auth-title">Ověření e-mailu</h2>
        {status === 'busy' && <p className="auth-sub">Ověřuji…</p>}
        {status === 'ok' && <p className="auth-sub">Hotovo — e-mail je ověřený. ✅</p>}
        {status === 'error' && (
          <div className="error-banner">Odkaz je neplatný nebo vypršel.</div>
        )}
        <a className="auth-btn" href="/" style={{ textDecoration: 'none' }}>
          Zpět do bpad
        </a>
      </div>
    </div>
  )
}
