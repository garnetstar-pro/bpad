import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearSession } from './session'
import { isTouchPrimary } from './device'

interface AuthState {
  username: string | null
  isAuthenticated: boolean
  // Idle-locked: session keys cleared, username remembered → show the lock screen.
  locked: boolean
  // Called after a successful login/registration/recovery (the session is already set).
  authenticate: (username: string) => void
  logout: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

// Lock the vault after this much inactivity (desktop only; also re-checked when
// the tab regains focus, so returning to a backgrounded tab after the timeout
// locks too).
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  // When the API hits a 401 (expired token), send the user back to login.
  useEffect(() => {
    const onUnauthorized = () => {
      setLocked(false)
      setUsername(null)
    }
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

  // Idle lock (desktop only — not on touch devices). Clears the in-memory keys
  // and shows the lock screen; the username is kept for a quick password re-auth.
  useEffect(() => {
    if (username === null || locked || isTouchPrimary()) return
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const check = () => {
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        clearSession()
        setLocked(true)
      }
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    const timer = setInterval(check, 30_000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      clearInterval(timer)
    }
  }, [username, locked])

  const value: AuthState = {
    username,
    isAuthenticated: username !== null,
    locked,
    authenticate: (u) => {
      setLocked(false)
      setUsername(u)
    },
    logout: () => {
      clearSession()
      setLocked(false)
      setUsername(null)
    },
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
