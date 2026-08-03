import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearSession } from './session'
import { rememberUser, forgetRememberedUser } from './rememberedUser'
import { getAutoLockPref } from './preferences'

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  // Incremented by bpad:lockpref-changed to re-run the idle-lock effect immediately
  // when the user changes the auto-lock preference from the Account page.
  const [prefVersion, setPrefVersion] = useState(0)

  // When the API hits a 401 (expired token), send the user back to login.
  useEffect(() => {
    const onUnauthorized = () => {
      setLocked(false)
      setUsername(null)
    }
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

  // Re-run idle-lock effect when user changes the preference from Account page.
  useEffect(() => {
    const onPrefChanged = () => setPrefVersion((v) => v + 1)
    window.addEventListener('bpad:lockpref-changed', onPrefChanged)
    return () => window.removeEventListener('bpad:lockpref-changed', onPrefChanged)
  }, [])

  // Idle lock. Works on all devices (desktop + mobile).
  // Timeout is read from user preference (getAutoLockPref).
  // null = "never" → no lock installed.
  // Also re-checked when the tab regains focus, so returning to a backgrounded
  // tab after the timeout locks too.
  useEffect(() => {
    if (username === null || locked) return
    const autoLockMinutes = getAutoLockPref()
    if (autoLockMinutes === null) return  // "never" — don't install the timer
    const timeoutMs = autoLockMinutes * 60_000

    let last = Date.now()
    let awayAt: number | null = null
    const lock = () => { clearSession(); setLocked(true) }
    const bump = () => { last = Date.now() }
    const idleCheck = () => { if (Date.now() - last > timeoutMs) lock() }
    // Tab hidden or window blurred → remember when we left.
    const leave = () => { if (awayAt === null) awayAt = Date.now() }
    // Back on the tab/window → lock if we were away long enough.
    const back = () => {
      if (awayAt !== null) {
        const away = Date.now() - awayAt
        awayAt = null
        if (away >= timeoutMs) return lock()
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
  }, [username, locked, prefVersion])

  const value: AuthState = {
    username,
    isAuthenticated: username !== null,
    locked,
    authenticate: (u) => {
      // Remembered across page loads so a reload lands on the lock screen
      // rather than the public landing page (see rememberedUser.ts).
      rememberUser(u)
      setLocked(false)
      setUsername(u)
    },
    logout: () => {
      // An explicit log out is the one case where we forget who was here; an
      // expired token (bpad:unauthorized, above) deliberately does not.
      forgetRememberedUser()
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
