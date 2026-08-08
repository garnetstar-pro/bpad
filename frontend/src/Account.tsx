import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { getAccount, resendVerification, savePreferences, type Account as AccountData } from './authApi'
import { getKnownNoteCount } from './api'
import { MIN_PASSPHRASE_LENGTH } from './backup'
import { exportBackup, type ExportProgress } from './backupExport'
import { archiveFilename, downloadArchive } from './backupFile'
import { sendFeedback, FEEDBACK_MAX_LENGTH } from './feedbackApi'
import { UNVERIFIED_NOTE_LIMIT } from './verifyStatus'
import { getUsername } from './session'
import { useTranslation, availableLocales, type Locale } from './i18n'
import { getAutoLockPref, setAutoLockPref } from './preferences'

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
  const [autoLock, setAutoLock] = useState<number | null>(() => getAutoLockPref())
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
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
  const [bkImages, setBkImages] = useState(0)
  const [bkMissing, setBkMissing] = useState(0)
  const [bkProgress, setBkProgress] = useState<ExportProgress | null>(null)

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

  async function handleAutoLockChange(value: string) {
    const minutes = value === 'never' ? null : parseInt(value, 10)
    // Sentinel: null → 0 for server, positive number directly.
    const serverValue = minutes === null ? 0 : minutes
    setAutoLock(minutes)
    setAutoLockPref(minutes)
    window.dispatchEvent(new Event('bpad:lockpref-changed'))
    // Best-effort server sync — same pattern as sortBy preference.
    savePreferences(account?.sortBy ?? 'created', serverValue).catch(() => {})
  }

  function backupValidationError(): string {    if (bkMode === 'plain') return ''
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
    setBkProgress(null)
    try {
      const result = await exportBackup({
        username: getUsername() ?? '',
        passphrase: bkMode === 'plain' ? undefined : bkPass,
        onProgress: setBkProgress,
      })
      if (result.noteCount === 0) {
        setBkError(t('account.backupEmpty'))
        setBkState('error')
        return
      }
      downloadArchive(result.archive, archiveFilename(result.exportedAt, bkMode !== 'plain'))
      setBkCount(result.noteCount)
      setBkImages(result.imageCount)
      setBkMissing(result.missingImages.length)
      setBkPass('')
      setBkPass2('')
      setBkState('done')
    } catch (e) {
      setBkError(e instanceof Error ? e.message : t('errors.loadFailed'))
      setBkState('error')
    } finally {
      setBkProgress(null)
    }
  }

  function backupButtonLabel(): string {
    if (bkState !== 'working') return t('account.backupDownload')
    if (bkProgress?.phase === 'images') {
      return t('account.backupImages', { done: bkProgress.done, total: bkProgress.total })
    }
    if (bkProgress?.phase === 'packing') return t('account.backupPacking')
    return t('account.backupWorking')
  }

  const noteCount = getKnownNoteCount()
  const verified = account?.emailVerified

  return (
    <div className="detail-page">
      <Link to="/" className="back-link">{t('common.back')}</Link>

      <div className="account-page">
        <h2 className="account-page-title">{t('account.title')}</h2>

        <section className="account-panel">
          <h3 className="account-panel-title">{t('account.sectionProfile')}</h3>

          {loading && <div className="account-panel-body">{t('common.loading')}</div>}

          {!loading && offline && (
            <>
              <div className="account-panel-body is-rows">
                <div className="account-row">
                  <span className="account-key">{t('account.username')}</span>
                  <span className="account-val">{getUsername() ?? '—'}</span>
                </div>
              </div>
              <div className="account-panel-foot">
                <div className="account-note">{t('account.emailOffline')}</div>
              </div>
            </>
          )}

          {!loading && account && (
            <>
              <div className="account-panel-body is-rows">
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
              </div>

              {!verified && (
                <div className="account-panel-foot">
                  <div className="account-note">
                    {t('account.verifyCta')}{' '}
                    {resend === 'sent' ? (
                      <span className="verify-sent">{t('account.sent')}</span>
                    ) : (
                      <button
                        className="verify-resend"
                        type="button"
                        disabled={resend === 'sending'}
                        onClick={() => {
                          setResend('sending')
                          resendVerification()
                            .then(() => setResend('sent'))
                            .catch(() => setResend('error'))
                        }}
                      >
                        {resend === 'sending'
                          ? t('account.sending')
                          : resend === 'error'
                            ? t('account.sendFailed')
                            : t('account.sendLink')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <section className="account-panel">
          <h3 className="account-panel-title">{t('account.sectionPreferences')}</h3>
          <div className="account-panel-body is-rows">
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

            <div className="account-row">
              <span className="account-key">{t('account.autoLock')}</span>
              <select
                className="account-val"
                value={autoLock === null ? 'never' : String(autoLock)}
                onChange={(e) => handleAutoLockChange(e.target.value)}
              >
                <option value="never">{t('account.autoLockNever')}</option>
                <option value="1">{t('account.autoLock1')}</option>
                <option value="5">{t('account.autoLock5')}</option>
                <option value="15">{t('account.autoLock15')}</option>
                <option value="30">{t('account.autoLock30')}</option>
                <option value="60">{t('account.autoLock60')}</option>
              </select>
            </div>
          </div>
        </section>

        <section className="account-panel">
          <h3 className="account-panel-title">{t('account.backupTitle')}</h3>
          <div className="account-panel-body">
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
              {backupButtonLabel()}
            </button>

            {bkState === 'done' && (
              <>
                <div className="verify-sent">
                  {t('account.backupDone', { count: bkCount, images: bkImages })}
                </div>
                {bkMissing > 0 && (
                  <div className="account-note">
                    {t('account.backupImagesMissing', { count: bkMissing })}
                  </div>
                )}
              </>
            )}
            {bkState === 'error' && <div className="account-note">{bkError}</div>}
          </div>

          <div className="account-panel-foot">
            <Link to="/restore" className="account-link">{t('account.backupRestoreLink')}</Link>
          </div>
        </section>

        <section className="account-panel">
          <h3 className="account-panel-title">{t('account.feedbackTitle')}</h3>
          <div className="account-panel-body">
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
        </section>

        {/* The feature overview is reachable from the header and the app footer
            on every page, so it no longer needs a slot here. */}
        <div className="account-footer">
          <button className="ghost-btn" onClick={logout} type="button">
            {t('common.logOut')}
          </button>
        </div>
      </div>
    </div>
  )
}
