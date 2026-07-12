// Orchestrates biometric unlock: wraps the vault keys with a PRF key and
// stores them (ciphertext only) in localStorage; on unlock it unwraps them
// and restores the session via a re-login. The password is never stored.
import { encryptJSON, decryptJSON, toBase64, fromBase64 } from './crypto'
import { getAuthKey, getDataKey } from './session'
import { loginWithAuthKey } from './authApi'
import * as webauthn from './webauthn'
import { translate } from './i18n'

const STORE_KEY = 'bpad.biometric'
const DECLINED_KEY = 'bpad.biometric.declined'

interface Enrollment {
  username: string
  credentialId: string
  wrapped: { iv: string; ct: string }
}

interface StoredKeys {
  authKey: string // base64
  dataKey: string // base64
}

export const isBiometricAvailable = webauthn.isBiometricAvailable

export function getEnrollment(): Enrollment | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Enrollment) : null
  } catch {
    return null
  }
}

export function hasEnrollment(): boolean {
  return getEnrollment() !== null
}

export function declinedBiometric(): boolean {
  return localStorage.getItem(DECLINED_KEY) === '1'
}

export function declineBiometric(): void {
  localStorage.setItem(DECLINED_KEY, '1')
}

export function forget(): void {
  localStorage.removeItem(STORE_KEY)
}

// Enable on this device (the user is logged in).
export async function enroll(username: string): Promise<void> {
  const authKey = getAuthKey()
  const dataKey = getDataKey()
  if (!authKey || !dataKey) throw new Error(translate('errors.vaultLocked'))

  const { credentialId, prfKey } = await webauthn.enroll(username)
  const payload: StoredKeys = { authKey: toBase64(authKey), dataKey: toBase64(dataKey) }
  const wrapped = await encryptJSON(payload, prfKey)

  const enrollment: Enrollment = { username, credentialId, wrapped }
  localStorage.setItem(STORE_KEY, JSON.stringify(enrollment))
  localStorage.removeItem(DECLINED_KEY)
}

// Unlock with a fingerprint: returns the logged-in user's username.
export async function unlock(): Promise<string> {
  const enrollment = getEnrollment()
  if (!enrollment) throw new Error(translate('errors.noBiometricEnrollment'))

  const prfKey = await webauthn.getPrfKey(enrollment.credentialId)
  let keys: StoredKeys
  try {
    keys = await decryptJSON<StoredKeys>(enrollment.wrapped, prfKey)
  } catch {
    throw new Error(translate('errors.biometricUnwrapFailed'))
  }

  try {
    await loginWithAuthKey(enrollment.username, fromBase64(keys.authKey), fromBase64(keys.dataKey))
  } catch (err) {
    // Saved login is no longer valid (password changed elsewhere) → forget it.
    if (err instanceof Error && err.message.includes('no longer valid')) forget()
    throw err
  }
  return enrollment.username
}
