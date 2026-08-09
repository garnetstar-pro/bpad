import { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useTranslation } from './i18n'
import { useAuth } from './AuthContext'
import AuthGate, { type Mode } from './AuthGate'
import Landing from './Landing'
import VerifyEmail from './VerifyEmail'
import BiometricUnlock from './BiometricUnlock'
import BiometricEnrollPrompt from './BiometricEnrollPrompt'
import { hasEnrollment, declinedBiometric, isBiometricAvailable } from './biometric'
import { getRememberedUser } from './rememberedUser'
import { entryScreen } from './coldStart'
import { isOfflineReadOnly } from './session'
import { getEmailVerified, resendVerification } from './authApi'
import { getKnownNoteCount } from './api'
import { verifyBannerMessage } from './verifyStatus'
import BpadMark from './BpadMark'
import AppFooter from './AppFooter'
import NotesLayout from './NotesLayout'
import DetailPlaceholder from './DetailPlaceholder'
import NoteDetail from './NoteDetail'
import Account from './Account'
import Features from './Features'
import Capture from './Capture'
import ShareTarget from './ShareTarget'
import KeyboardShortcuts from './KeyboardShortcuts'
import Restore from './Restore'
import LockScreen from './LockScreen'
import './App.css'

function App() {
  const { t } = useTranslation()
  const { isAuthenticated, username, locked, authenticate, logout } = useAuth()
  const location = useLocation()
  const [usePassword, setUsePassword] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [enrollDone, setEnrollDone] = useState(false)
  const [forceEnroll, setForceEnroll] = useState(false)
  const [verifySend, setVerifySend] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [noteCount, setNoteCount] = useState<number | null>(getKnownNoteCount())
  // null = show the public landing; otherwise the auth form opens in this mode.
  const [authMode, setAuthMode] = useState<Mode | null>(null)
  // Who last unlocked the vault in this browser. Read once on mount; cleared
  // when the user asks to log in as someone else.
  const [remembered, setRemembered] = useState(getRememberedUser)

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable)
  }, [])

  // Re-evaluate the banner counter when the note count changes.
  useEffect(() => {
    const sync = () => setNoteCount(getKnownNoteCount())
    window.addEventListener('bpad:notes-changed', sync)
    return () => window.removeEventListener('bpad:notes-changed', sync)
  }, [])

  // Verification link from the e-mail – works without being logged in too.
  if (location.pathname === '/verify') return <VerifyEmail />

  // Restoring a backup must work for a locked-out visitor — that is the whole
  // point of having one — so it is handled before the authentication check,
  // and before the catch-all Capture route would swallow the path.
  if (location.pathname === '/restore') return <Restore />

  if (!isAuthenticated) {
    // The session lives only in memory, so any full page load lands here —
    // including a reload or a pasted /notes/… link. Rendering the lock screen
    // instead of navigating keeps the requested URL, so unlocking lands on it.
    switch (
      entryScreen({
        hasEnrollment: hasEnrollment(),
        usePassword,
        wantsAuthForm: authMode !== null,
        remembered,
      })
    ) {
      case 'biometric':
        return <BiometricUnlock onUnlocked={authenticate} onPassword={() => setUsePassword(true)} />
      case 'lock':
        return (
          <LockScreen
            username={remembered!}
            sub={t('lock.subReturning')}
            onSwitchUser={() => setRemembered(null)}
          />
        )
      // New visitors see the public landing first; the CTAs open the auth form.
      case 'landing':
        return (
          <Landing
            onGetStarted={() => setAuthMode('register')}
            onLogin={() => setAuthMode('login')}
          />
        )
      case 'auth':
        return <AuthGate initialMode={authMode!} onBack={() => setAuthMode(null)} />
    }
  }

  // Idle-locked: hide the content behind the lock screen (password re-auth).
  if (locked && username) return <LockScreen username={username} />

  const canOfferBio = bioAvailable && !hasEnrollment()
  const showEnroll =
    !!username && canOfferBio && (forceEnroll || (!declinedBiometric() && !enrollDone))

  return (
    <div className="app">
      <KeyboardShortcuts />
      <header className="app-header">
        <Link to="/" className="app-brand">
          <BpadMark size={40} />
          <div>
            <div className="case-number">{t('auth.brandKicker')}</div>
            <div className="app-title">bpad</div>
          </div>
        </Link>
        <div className="app-meta">
          <Link to="/account" className="app-user-link">{username}</Link>
          <Link to="/features" className="logout-link">{t('common.help')}</Link>
          {canOfferBio && (
            <button
              className="logout-link"
              onClick={() => {
                setForceEnroll(true)
                setEnrollDone(false)
              }}
              type="button"
            >
              {t('biometric.enableLink')}
            </button>
          )}
          <button className="logout-link" onClick={logout} type="button">{t('common.logOut')}</button>
        </div>
      </header>

      {isOfflineReadOnly() && (
        <div className="offline-banner">{t('offline.banner')}</div>
      )}

      {getEmailVerified() === false && (
        <div className="verify-banner">
          <span>{verifyBannerMessage(noteCount)}</span>{' '}
          {verifySend === 'sent' ? (
            <span className="verify-sent">{t('verify.sent')}</span>
          ) : (
            <button
              className="verify-resend"
              type="button"
              disabled={verifySend === 'sending'}
              onClick={() => {
                setVerifySend('sending')
                resendVerification()
                  .then(() => setVerifySend('sent'))
                  .catch(() => setVerifySend('error'))
              }}
            >
              {verifySend === 'sending'
                ? t('verify.sending')
                : verifySend === 'error'
                  ? t('verify.sendFailed')
                  : t('verify.sendLink')}
            </button>
          )}
        </div>
      )}

      <Routes>
        <Route element={<NotesLayout />}>
          <Route path="/" element={<DetailPlaceholder />} />
          <Route path="/notes/:id" element={<NoteDetail />} />
        </Route>
        <Route path="/account" element={<Account />} />
        <Route path="/features" element={<Features />} />
        {/* Android share sheet target (manifest share_target). Must be listed
            before the catch-all would swallow it — Capture only understands a
            URL in the path, not a share payload in the query. */}
        <Route path="/share" element={<ShareTarget />} />
        {/* Catch-all: captures dev.bpad.pro/https://… or falls back home */}
        <Route path="*" element={<Capture />} />
      </Routes>

      <AppFooter />

      {showEnroll && username && (
        <BiometricEnrollPrompt
          username={username}
          onDone={() => {
            setEnrollDone(true)
            setForceEnroll(false)
          }}
        />
      )}
    </div>
  )
}

export default App
