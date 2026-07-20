import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getAccount, resendVerification, type Account as AccountData } from './authApi'
import { getKnownNoteCount, listNotes } from './api'
import { serializeBackup, encryptBackup, MIN_PASSPHRASE_LENGTH } from './backup'
import { downloadBackup } from './backupFile'
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
  const [bkMode, setBkMode] = useState<'protected' | 'plain'>('protected')
  const [bkPass, setBkPass] = useState('')
  const [bkPass2, setBkPass2] = useState('')
  const [bkAck, setBkAck] = useState(false)
  const [bkState, setBkState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [bkError, setBkError] = useState('')
  const [bkCount, setBkCount] = useState(0)

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

  function backupValidationError(): string {
    if (bkMode === 'plain') return ''
    if (bkPass.length < MIN_PASSPHRASE_LENGTH) {
      return t('account.backupPassphraseTooShort', { min: MIN_PASSPHRASE_LENGTH })
    }
    if (bkPass !== bkPass2) return t('account.backupPassphraseMismatch')
    return ''
  }

  async function downloadBackupFile() {
    const invalid = backupValidationError()
    if (invalid) {
      setBkError(invalid)
      setBkState('error')
      return
    }
    setBkState('working')
    try {
      // listNotes() falls back to the offline cache, so a backup still works
      // without the network — it just backs up what this device knows.
      const notes = await listNotes()
      if (notes.length === 0) {
        setBkError(t('account.backupEmpty'))
        setBkState('error')
        return
      }
      const plain = serializeBackup(notes, { username: getUsername() ?? '' })
      downloadBackup(bkMode === 'plain' ? plain : await encryptBackup(plain, bkPass))
      setBkCount(notes.length)
      setBkPass('')
      setBkPass2('')
      setBkState('done')
    } catch (e) {
      setBkError(e instanceof Error ? e.message : t('errors.loadFailed'))
      setBkState('error')
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

        <div className="account-backup">
          <span className="account-key">{t('account.backupTitle')}</span>
          <div className="account-note">{t('account.backupIntro')}</div>

          <label className="backup-choice">
            <input
              type="radio"
              name="backup-mode"
              checked={bkMode === 'protected'}
              onChange={() => {
                setBkMode('protected')
                setBkState('idle')
              }}
            />
            {t('account.backupProtected')}
          </label>
          <label className="backup-choice">
            <input
              type="radio"
              name="backup-mode"
              checked={bkMode === 'plain'}
              onChange={() => {
                setBkMode('plain')
                setBkState('idle')
              }}
            />
            {t('account.backupPlain')}
          </label>

          {bkMode === 'protected' ? (
            <>
              <input
                className="backup-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('account.backupPassphrase')}
                value={bkPass}
                onChange={(e) => {
                  setBkPass(e.target.value)
                  if (bkState === 'error') setBkState('idle')
                }}
              />
              <input
                className="backup-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('account.backupPassphraseAgain')}
                value={bkPass2}
                onChange={(e) => {
                  setBkPass2(e.target.value)
                  if (bkState === 'error') setBkState('idle')
                }}
              />
              <div className="account-note">{t('account.backupPassphraseHint')}</div>
            </>
          ) : (
            <label className="backup-choice">
              <input
                type="checkbox"
                checked={bkAck}
                onChange={(e) => setBkAck(e.target.checked)}
              />
              {t('account.backupPlainWarning')}
            </label>
          )}

          <button
            className="ghost-btn"
            type="button"
            disabled={bkState === 'working' || (bkMode === 'plain' && !bkAck)}
            onClick={downloadBackupFile}
          >
            {bkState === 'working' ? t('account.backupWorking') : t('account.backupDownload')}
          </button>

          {bkState === 'done' && (
            <div className="verify-sent">{t('account.backupDone', { count: bkCount })}</div>
          )}
          {bkState === 'error' && <div className="account-note">{bkError}</div>}

          <div>
            <Link to="/restore" className="account-link">{t('account.backupRestoreLink')}</Link>
          </div>
        </div>

        <div className="account-feedback">
          <span className="account-key">{t('account.feedbackTitle')}</span>
          <div className="account-note">{t('account.feedbackIntro')}</div>
          {fbState === 'sent' ? (
            <>
              <div className="verify-sent">{t('account.feedbackThanks')}</div>
              <button
                className="ghost-btn"
                type="button"
                onClick={() => setFbState('idle')}
              >
                {t('account.feedbackSendAnother')}
              </button>
            </>
          ) : (
            <>
              <textarea
                className="feedback-input"
                rows={4}
                value={feedback}
                maxLength={FEEDBACK_MAX_LENGTH}
                placeholder={t('account.feedbackPlaceholder')}
                onChange={(e) => {
                  setFeedback(e.target.value)
                  if (fbState === 'error') setFbState('idle')
                }}
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
