// Which screen an unauthenticated visitor gets. Extracted from App so the
// precedence is testable without a DOM (the suite runs in plain Node).
export type EntryScreen = 'biometric' | 'auth' | 'lock' | 'landing'

export function entryScreen(state: {
  // A biometric credential is enrolled on this device.
  hasEnrollment: boolean
  // The user chose to type a password instead of using the fingerprint.
  usePassword: boolean
  // The user explicitly opened the login/register form from the landing page.
  wantsAuthForm: boolean
  // Who last unlocked the vault in this browser, if anyone.
  remembered: string | null
}): EntryScreen {
  if (state.hasEnrollment && !state.usePassword) return 'biometric'
  // An explicit request for the form wins over the remembered user — that is
  // how "log in as someone else" gets out of the lock screen.
  if (state.wantsAuthForm) return 'auth'
  if (state.remembered) return 'lock'
  return 'landing'
}
