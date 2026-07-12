import { useState } from 'react'
import { enroll, declineBiometric } from './biometric'
import { isUnsupportedError, friendlyError } from './webauthn'
import { useTranslation } from './i18n'

// Offer shown after login: turn on fingerprint unlock on this device.
export default function BiometricEnrollPrompt({
  username,
  onDone,
}: {
  username: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      await enroll(username)
      onDone()
    } catch (err) {
      // If the browser can't do it (cert/unsupported), quietly stop offering.
      if (isUnsupportedError(err)) {
        declineBiometric()
        onDone()
        return
      }
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  const later = () => {
    declineBiometric()
    onDone()
  }

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <h3 className="modal-title">{t('biometric.enrollTitle')}</h3>
        <p className="modal-text">
          {t('biometric.enrollText')}
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button className="ghost-btn" onClick={later} disabled={busy} type="button">
            {t('biometric.later')}
          </button>
          <button className="save-btn" onClick={enable} disabled={busy} type="button">
            {busy ? t('biometric.enrolling') : t('biometric.enable')}
          </button>
        </div>
      </div>
    </div>
  )
}
