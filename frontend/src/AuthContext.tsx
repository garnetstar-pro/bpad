import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearSession } from './session'

interface AuthState {
  username: string | null
  isAuthenticated: boolean
  // Called after a successful login/registration/recovery (the session is already set).
  authenticate: (username: string) => void
  logout: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

// Log out after this much inactivity (also re-checked when the tab regains
// focus, so returning to a backgrounded tab after the timeout logs out too).
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)

  // When the API hits a 401 (expired token), send the user back to login.
  useEffect(() => {
    const onUnauthorized = () => setUsername(null)
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

  // Idle auto-logout (only while signed in).
  useEffect(() => {
    if (username === null) return
    let last = Date.now()
    const bump = () => { last = Date.now() }
    const check = () => {
      if (Date.now() - last > IDLE_TIMEOUT_MS) {
        clearSession()
        setUsername(null)
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
  }, [username])

  const value: AuthState = {
    username,
    isAuthenticated: username !== null,
    authenticate: setUsername,
    logout: () => {
      clearSession()
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
