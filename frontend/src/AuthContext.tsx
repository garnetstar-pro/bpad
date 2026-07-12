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
  // Primary trigger: leaving the tab/window (switch tab or app) and coming back
  // after the timeout. Also locks after the timeout of foreground inactivity.
  useEffect(() => {
    if (username === null || locked || isTouchPrimary()) return
    let last = Date.now()
    let awayAt: number | null = null
    const lock = () => {
      clearSession()
      setLocked(true)
    }
    const bump = () => { last = Date.now() }
    const idleCheck = () => { if (Date.now() - last > IDLE_TIMEOUT_MS) lock() }
    // Tab hidden or window blurred → remember when we left.
    const leave = () => { if (awayAt === null) awayAt = Date.now() }
    // Back on the tab/window → lock if we were away long enough.
    const back = () => {
      if (awayAt !== null) {
        const away = Date.now() - awayAt
        awayAt = null
        if (away >= IDLE_TIMEOUT_MS) return lock()
      }
      last = Date.now() // fresh start; don't lock from a stale foreground timer
    }
    const onVisibility = () =>
      document.visibilityState === 'hidden' ? leave() : back()

    const activity = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    activity.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(idleCheck, 30_000)
    return () => {
      activity.forEach((e) => window.removeEventListener(e, bump))
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', onVisibility)
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
