import { useState } from 'react'
import BpadMark from './BpadMark'
import { getEnrollment, unlock, forget } from './biometric'
import { friendlyError } from './webauthn'
import { useTranslation } from './i18n'

export default function BiometricUnlock({
  onUnlocked,
  onPassword,
}: {
  onUnlocked: (username: string) => void
  onPassword: () => void
}) {
  const { t } = useTranslation()
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
              <div className="brand-kicker">{t('auth.brandKicker')}</div>
              <div className="brand">bpad</div>
            </div>
          </div>
          <div className="brand-meta">locked</div>
        </div>

        <h2 className="auth-title">{t('biometric.unlockTitle')}</h2>
        <p className="auth-sub">{t('biometric.loggedInAs', { username: enrollment?.username ?? '' })}</p>
        {error && <div className="error-banner">{error}</div>}

        <button className="auth-btn" onClick={doUnlock} disabled={busy} type="button">
          {busy ? t('biometric.unlocking') : t('biometric.unlock')}
        </button>

        <div className="auth-links">
          <button className="auth-link accent" onClick={onPassword} type="button">
            {t('biometric.usePasswordInstead')}
          </button>
          <button className="auth-link" onClick={forgetDevice} type="button">
            {t('biometric.forgetDevice')}
          </button>
        </div>
        <div className="auth-hint">
          {t('biometric.hint')}
        </div>
      </div>
    </div>
  )
}
