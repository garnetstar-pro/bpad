import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getAccount, resendVerification, type Account as AccountData } from './authApi'
import { getKnownNoteCount } from './api'
import { sendFeedback, FEEDBACK_MAX_LENGTH } from './feedbackApi'
import { UNVERIFIED_NOTE_LIMIT } from './verifyStatus'
import { getUsername } from './session'
import { useTranslation, availableLocales, type Locale } from './i18n'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function Account() {
  const { t, locale, setLocale } = useTranslation()
  const { logout } = useAuth()
  const [account, setAccount] = useState<AccountData | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resend, setResend] = useState<'idle' | 'sent' | 'error'>('idle')
  const [feedback, setFeedback] = useState('')
  const [fbState, setFbState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [fbError, setFbError] = useState('')

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch(() => setOffline(true))
      .finally(() => setLoading(false))
  }, [])

  async function submitFeedback() {
    setFbState('sending')
    try {
      await sendFeedback(feedback.trim())
      setFeedback('')
      setFbState('sent')
    } catch (e) {
      setFbError(e instanceof Error ? e.message : t('errors.feedbackFailed'))
      setFbState('error')
    }
  }

  const noteCount = getKnownNoteCount()
  const verified = account?.emailVerified

  return (
    <div className="detail-page">
      <Link to="/" className="back-link">{t('common.back')}</Link>

      <div className="account-card">
        <h2 className="account-title">{t('account.title')}</h2>

        {availableLocales().length > 1 && (
          <div className="account-row">
            <span className="account-key">{t('account.language')}</span>
            <select
              className="account-val"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              {availableLocales().map((l) => (
                <option key={l} value={l}>{l.toUpperCase()}</option>
              ))}
            </select>
          </div>
        )}

        {loading && <div className="empty-state">{t('common.loading')}</div>}

        {!loading && offline && (
          <>
            <div className="account-row">
              <span className="account-key">{t('account.username')}</span>
              <span className="account-val">{getUsername() ?? '—'}</span>
            </div>
            <div className="account-note">{t('account.emailOffline')}</div>
          </>
        )}

        {!loading && account && (
          <>
            <div className="account-row">
              <span className="account-key">{t('account.username')}</span>
              <span className="account-val">{account.username}</span>
            </div>
            <div className="account-row">
              <span className="account-key">{t('account.email')}</span>
              <span className="account-val">
                {account.email ?? '—'}{' '}
                <span className={verified ? 'account-badge is-ok' : 'account-badge'}>
                  {verified ? t('account.verified') : t('account.unverified')}
                </span>
              </span>
            </div>
            <div className="account-row">
              <span className="account-key">{t('account.notes')}</span>
              <span className="account-val">
                {noteCount ?? '—'}
                {!verified && noteCount !== null && ` ${t('account.ofLimit', { limit: UNVERIFIED_NOTE_LIMIT })}`}
              </span>
            </div>
            <div className="account-row">
              <span className="account-key">{t('account.joined')}</span>
              <span className="account-val">{formatDate(account.createdAt)}</span>
            </div>

            {!verified && (
              <div className="account-note">
                {t('account.verifyCta')}{' '}
                {resend === 'sent' ? (
                  <span className="verify-sent">{t('account.sent')}</span>
                ) : (
                  <button
                    className="verify-resend"
                    type="button"
                    onClick={() =>
                      resendVerification()
                        .then(() => setResend('sent'))
                        .catch(() => setResend('error'))
                    }
                  >
                    {resend === 'error' ? t('account.sendFailed') : t('account.sendLink')}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <div>
          <Link to="/features" className="account-link">{t('account.whatCanDo')}</Link>
        </div>

        <div className="account-feedback">
          <span className="account-key">{t('account.feedbackTitle')}</span>
          <div className="account-note">{t('account.feedbackIntro')}</div>
          {fbState === 'sent' ? (
            <div className="verify-sent">{t('account.feedbackThanks')}</div>
          ) : (
            <>
              <textarea
                className="feedback-input"
                rows={4}
                value={feedback}
                maxLength={FEEDBACK_MAX_LENGTH}
                placeholder={t('account.feedbackPlaceholder')}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <div className="account-note">{t('account.feedbackNotEncrypted')}</div>
              <button
                className="ghost-btn"
                type="button"
                disabled={fbState === 'sending' || feedback.trim() === ''}
                onClick={submitFeedback}
              >
                {fbState === 'sending' ? t('account.feedbackSending') : t('account.feedbackSend')}
              </button>
              {fbState === 'error' && <div className="account-note">{fbError}</div>}
            </>
          )}
        </div>

        <button className="ghost-btn account-logout" onClick={logout} type="button">
          {t('common.logOut')}
        </button>
      </div>
    </div>
  )
}
