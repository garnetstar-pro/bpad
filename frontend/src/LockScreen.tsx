import { useState } from 'react'
import { useAuth } from './AuthContext'
import * as authApi from './authApi'
import { useTranslation } from './i18n'
import { canAutofocus } from './device'
import BpadMark from './BpadMark'

// Shown when the keys are gone but we still know whose vault this is: after an
// idle lock, or on a cold page load (App resolves that via coldStart.ts). Asks
// for the password to unlock — or offers a full login.
export default function LockScreen({
  username,
  sub,
  onSwitchUser,
}: {
  username: string
  // Why the vault is locked; defaults to the idle-lock explanation.
  sub?: string
  // Extra cleanup for the caller when the user wants a different account —
  // `logout()` below already clears the session and the remembered user.
  onSwitchUser?: () => void
}) {
  const { t } = useTranslation()
  const { authenticate, logout } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await authApi.login(username, password)
      authenticate(username) // clears the lock and restores the vault
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lock.failed'))
      setBusy(false)
    }
  }

  return (
    <div className="auth-page lock-page">
      <div className="auth-card">
        <div className="lock-head">
          <BpadMark size={34} />
          <div>
            <div className="brand-kicker">{t('lock.title')}</div>
            <div className="lock-user">{username}</div>
          </div>
        </div>
        <p className="auth-sub">{sub ?? t('lock.sub')}</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={submit}>
          {/* Hidden username so a password manager can match the right entry
              on this re-auth screen — it fills nothing without it. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            readOnly
            hidden
          />
          <input
            className="auth-input"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('lock.password')}
            autoFocus={canAutofocus()}
            disabled={busy}
            autoComplete="current-password"
          />
          <button className="auth-btn" type="submit" disabled={busy || !password}>
            {busy ? t('lock.unlocking') : t('lock.unlock')}
          </button>
        </form>
        <div className="auth-links">
          <button
            className="auth-link accent"
            onClick={() => {
              logout()
              onSwitchUser?.()
            }}
            type="button"
          >
            {t('lock.notYou')}
          </button>
          <span />
        </div>
      </div>
    </div>
  )
}
