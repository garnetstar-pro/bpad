import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getAccount, resendVerification, type Account as AccountData } from './authApi'
import { getKnownNoteCount } from './api'
import { UNVERIFIED_NOTE_LIMIT } from './verifyStatus'
import { getUsername } from './session'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('cs-CZ')
}

export default function Account() {
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
      <Link to="/" className="back-link">← zpět</Link>

      <div className="account-card">
        <h2 className="account-title">Účet</h2>

        {loading && <div className="empty-state">loading…</div>}

        {!loading && offline && (
          <>
            <div className="account-row">
              <span className="account-key">username</span>
              <span className="account-val">{getUsername() ?? '—'}</span>
            </div>
            <div className="account-note">E-mail se načte, až budeš online.</div>
          </>
        )}

        {!loading && account && (
          <>
            <div className="account-row">
              <span className="account-key">username</span>
              <span className="account-val">{account.username}</span>
            </div>
            <div className="account-row">
              <span className="account-key">e-mail</span>
              <span className="account-val">
                {account.email ?? '—'}{' '}
                <span className={verified ? 'account-badge is-ok' : 'account-badge'}>
                  {verified ? 'ověřeno ✓' : 'neověřeno'}
                </span>
              </span>
            </div>
            <div className="account-row">
              <span className="account-key">poznámek</span>
              <span className="account-val">
                {noteCount ?? '—'}
                {!verified && noteCount !== null && ` z ${UNVERIFIED_NOTE_LIMIT}`}
              </span>
            </div>
            <div className="account-row">
              <span className="account-key">založeno</span>
              <span className="account-val">{formatDate(account.createdAt)}</span>
            </div>

            {!verified && (
              <div className="account-note">
                Ověř e-mail, ať můžeš psát bez omezení.{' '}
                {resend === 'sent' ? (
                  <span className="verify-sent">Odesláno ✓</span>
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
                    {resend === 'error' ? 'Nepovedlo se, zkus znovu' : 'Poslat ověřovací odkaz'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        <button className="ghost-btn account-logout" onClick={logout} type="button">
          log out
        </button>
      </div>
    </div>
  )
}
