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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)

  // When the API hits a 401 (expired token), send the user back to login.
  useEffect(() => {
    const onUnauthorized = () => setUsername(null)
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

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
