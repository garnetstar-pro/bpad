import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getAccount, resendVerification, type Account as AccountData } from './authApi'
import { getKnownNoteCount } from './api'
import { UNVERIFIED_NOTE_LIMIT } from './verifyStatus'
import { getUsername } from './session'
import { useTranslation } from './i18n'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('cs-CZ')
}

export default function Account() {
  const { t } = useTranslation()
  const { logout } = useAuth()
  const [account, setAccount] = useState<AccountData | null>(null)
  const [offline, setOffline] = useState(false)
  const [loading, setLoading] = useState(true)
  const [resend, setResend] = useState<'idle' | 'sent' | 'error'>('idle')

  useEffect(() => {
    getAccount()
      .then(setAccount)
      .catch(() => setOffline(true))
      .finally(() => setLoading(false))
  }, [])

  const noteCount = getKnownNoteCount()
  const verified = account?.emailVerified

  return (
    <div className="detail-page">
      <Link to="/" className="back-link">{t('common.back')}</Link>

      <div className="account-card">
        <h2 className="account-title">{t('account.title')}</h2>

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

        <button className="ghost-btn account-logout" onClick={logout} type="button">
          {t('common.logOut')}
        </button>
      </div>
    </div>
  )
}
