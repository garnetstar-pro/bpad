import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import AuthGate from './AuthGate'
import BiometricUnlock from './BiometricUnlock'
import BiometricEnrollPrompt from './BiometricEnrollPrompt'
import { hasEnrollment, declinedBiometric, isBiometricAvailable } from './biometric'
import BpadMark from './BpadMark'
import Home from './Home'
import NoteDetail from './NoteDetail'
import './App.css'

function App() {
  const { isAuthenticated, username, authenticate, logout } = useAuth()
  const [usePassword, setUsePassword] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [enrollDone, setEnrollDone] = useState(false)

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable)
  }, [])

  if (!isAuthenticated) {
    if (hasEnrollment() && !usePassword) {
      return <BiometricUnlock onUnlocked={authenticate} onPassword={() => setUsePassword(true)} />
    }
    return <AuthGate />
  }

  const offerEnroll = bioAvailable && !hasEnrollment() && !declinedBiometric() && !enrollDone

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          <BpadMark size={40} />
          <div>
            <div className="case-number">blank pad · encrypted</div>
            <div className="app-title">bpad</div>
          </div>
        </Link>
        <div className="app-meta">
          {username}
          <br />
          <button className="logout-link" onClick={logout} type="button">log out</button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/notes/:id" element={<NoteDetail />} />
      </Routes>

      {offerEnroll && username && (
        <BiometricEnrollPrompt username={username} onDone={() => setEnrollDone(true)} />
      )}
    </div>
  )
}

export default App
