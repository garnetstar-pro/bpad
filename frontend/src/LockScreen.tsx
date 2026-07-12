import { useState } from 'react'
import { useAuth } from './AuthContext'
import * as authApi from './authApi'
import { useTranslation } from './i18n'
import { canAutofocus } from './device'
import BpadMark from './BpadMark'

// Shown after an idle lock: the content is gone (keys cleared) and we ask for
// the password to unlock the remembered user — or offer a full login.
export default function LockScreen({ username }: { username: string }) {
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
        <p className="auth-sub">{t('lock.sub')}</p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={submit}>
          <input
            className="auth-input"
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
          <button className="auth-link accent" onClick={logout} type="button">
            {t('lock.notYou')}
          </button>
          <span />
        </div>
      </div>
    </div>
  )
}
