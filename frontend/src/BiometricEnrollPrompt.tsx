import { useState } from 'react'
import { enroll, declineBiometric } from './biometric'
import { isUnsupportedError, friendlyError } from './webauthn'

// Nabídka po přihlášení: zapnout odemykání otiskem na tomto zařízení.
export default function BiometricEnrollPrompt({
  username,
  onDone,
}: {
  username: string
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      await enroll(username)
      onDone()
    } catch (err) {
      // Když to prohlížeč neumí (cert/nepodporováno), tiše přestaň nabízet.
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
        <h3 className="modal-title">Odemykat otiskem?</h3>
        <p className="modal-text">
          Příště se do trezoru dostaneš otiskem nebo Face ID místo hesla. Uloží se
          jen zašifrovaně na tomto zařízení — heslo se nikam neukládá.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="modal-actions">
          <button className="ghost-btn" onClick={later} disabled={busy} type="button">
            Teď ne
          </button>
          <button className="save-btn" onClick={enable} disabled={busy} type="button">
            {busy ? 'zapínám…' : 'Zapnout'}
          </button>
        </div>
      </div>
    </div>
  )
}
