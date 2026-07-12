import { useState, useEffect } from 'react'
import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useTranslation } from './i18n'
import { useAuth } from './AuthContext'
import AuthGate from './AuthGate'
import VerifyEmail from './VerifyEmail'
import BiometricUnlock from './BiometricUnlock'
import BiometricEnrollPrompt from './BiometricEnrollPrompt'
import { hasEnrollment, declinedBiometric, isBiometricAvailable } from './biometric'
import { isOfflineReadOnly } from './session'
import { getEmailVerified, resendVerification } from './authApi'
import { getKnownNoteCount } from './api'
import { verifyBannerMessage } from './verifyStatus'
import BpadMark from './BpadMark'
import Home from './Home'
import NoteDetail from './NoteDetail'
import Account from './Account'
import Features from './Features'
import Capture from './Capture'
import './App.css'

function App() {
  const { t } = useTranslation()
  const { isAuthenticated, username, authenticate, logout } = useAuth()
  const location = useLocation()
  const [usePassword, setUsePassword] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [enrollDone, setEnrollDone] = useState(false)
  const [forceEnroll, setForceEnroll] = useState(false)
  const [verifySend, setVerifySend] = useState<'idle' | 'sent' | 'error'>('idle')
  const [noteCount, setNoteCount] = useState<number | null>(getKnownNoteCount())

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

  if (!isAuthenticated) {
    if (hasEnrollment() && !usePassword) {
      return <BiometricUnlock onUnlocked={authenticate} onPassword={() => setUsePassword(true)} />
    }
    return <AuthGate />
  }

  const canOfferBio = bioAvailable && !hasEnrollment()
  const showEnroll =
    !!username && canOfferBio && (forceEnroll || (!declinedBiometric() && !enrollDone))

  return (
    <div className="app">
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
          <br />
          {canOfferBio && (
            <>
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
              <br />
            </>
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
              onClick={() => {
                resendVerification()
                  .then(() => setVerifySend('sent'))
                  .catch(() => setVerifySend('error'))
              }}
            >
              {verifySend === 'error' ? t('verify.sendFailed') : t('verify.sendLink')}
            </button>
          )}
        </div>
      )}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/notes/:id" element={<NoteDetail />} />
        <Route path="/account" element={<Account />} />
        <Route path="/features" element={<Features />} />
        {/* Catch-all: captures dev.bpad.pro/https://… or falls back home */}
        <Route path="*" element={<Capture />} />
      </Routes>

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
