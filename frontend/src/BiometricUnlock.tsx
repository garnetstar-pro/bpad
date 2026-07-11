import { useState } from 'react'
import BpadMark from './BpadMark'
import { getEnrollment, unlock, forget } from './biometric'
import { friendlyError } from './webauthn'

export default function BiometricUnlock({
  onUnlocked,
  onPassword,
}: {
  onUnlocked: (username: string) => void
  onPassword: () => void
}) {
  const enrollment = getEnrollment()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doUnlock = async () => {
    setBusy(true)
    setError(null)
    try {
      const username = await unlock()
      onUnlocked(username)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const forgetDevice = () => {
    forget()
    onPassword()
  }

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
          <div className="brand-meta">locked</div>
        </div>

        <h2 className="auth-title">Odemknout</h2>
        <p className="auth-sub">Přihlášen jako {enrollment?.username}.</p>
        {error && <div className="error-banner">{error}</div>}

        <button className="auth-btn" onClick={doUnlock} disabled={busy} type="button">
          {busy ? 'odemykám…' : 'Odemknout otiskem'}
        </button>

        <div className="auth-links">
          <button className="auth-link accent" onClick={onPassword} type="button">
            Zadat heslo místo toho
          </button>
          <button className="auth-link" onClick={forgetDevice} type="button">
            Zapomenout na zařízení
          </button>
        </div>
        <div className="auth-hint">
          Otisk odemkne klíč uložený jen v tomto zařízení. Heslo se nikam neposílá.
        </div>
      </div>
    </div>
  )
}
