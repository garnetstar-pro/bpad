import { useState, useEffect } from 'react'
import BpadMark from './BpadMark'
import { verifyEmail } from './authApi'
import { useTranslation } from './i18n'

// Page reached from the verification link in the e-mail (works without being logged in too).
export default function VerifyEmail() {
  const { t } = useTranslation()
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
              <div className="brand-kicker">{t('auth.brandKicker')}</div>
              <div className="brand">bpad</div>
            </div>
          </div>
          <div className="brand-meta">verify</div>
        </div>

        <h2 className="auth-title">{t('verify.title')}</h2>
        {status === 'busy' && <p className="auth-sub">{t('verify.checking')}</p>}
        {status === 'ok' && <p className="auth-sub">{t('verify.done')}</p>}
        {status === 'error' && (
          <div className="error-banner">{t('verify.invalid')}</div>
        )}
        <a className="auth-btn" href="/" style={{ textDecoration: 'none' }}>
          {t('verify.backToApp')}
        </a>
      </div>
    </div>
  )
}
