// Orchestrates client-side cryptography + auth API calls. Neither the
// password nor the keys ever leave the browser; only the verifier and the
// wrapped dataKey are sent to the server.
import {
  deriveKeys,
  generateSalt,
  generateDataKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  wrapDataKey,
  unwrapDataKey,
  toBase64,
  fromBase64,
} from './crypto'
import { setSession, getToken } from './session'
import { cacheAuth, getCachedAuth } from './offlineCache'
import { solvePow } from './pow'
import { translate } from './i18n'
import { setSortPref, type SortField } from './preferences'
import { setMaxImagesPerNote } from './entitlements'

const AUTH_URL = import.meta.env.DEV ? 'http://localhost:7071/api/auth' : '/api/auth'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

// E-mail verification state from the last login/registration (null =
// unknown, e.g. after a biometric/offline unlock). App reads this for the
// banner.
let emailVerified: boolean | null = null
export function getEmailVerified(): boolean | null {
  return emailVerified
}

// Signed-in account details (non-secret metadata) for the user's profile.
export interface Account {
  username: string
  email: string | null
  emailVerified: boolean
  createdAt: string | null
  sortBy: SortField
  maxImagesPerNote: number
}

export async function getAccount(): Promise<Account> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/me`, {
    headers: token ? { 'X-Auth-Token': token } : {},
  })
  if (!res.ok) throw new Error(translate('errors.accountLoadFailed'))
  const account: Account = await res.json()
  setSortPref(account.sortBy)
  setMaxImagesPerNote(account.maxImagesPerNote)
  return account
}

export async function savePreferences(sortBy: SortField): Promise<void> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/preferences`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(token ? { 'X-Auth-Token': token } : {}) },
    body: JSON.stringify({ sortBy }),
  })
  if (!res.ok) throw new Error(translate('errors.preferencesSaveFailed'))
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${AUTH_URL}/${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

// Registration: returns a one-time recovery code (show it to the user). The
// session is set on success (the user is effectively signed in).
export async function register(
  username: string,
  email: string,
  password: string,
  onSolving?: () => void,
): Promise<string> {
  const salt = generateSalt()
  const recoverySalt = generateSalt()
  const recoveryCode = generateRecoveryCode()

  const keys = await deriveKeys(password, salt)
  const recKeys = await deriveKeys(normalizeRecoveryCode(recoveryCode), recoverySalt)
  const dataKey = generateDataKey()
  const wrappedDataKeyPw = await wrapDataKey(dataKey, keys.encKey)

  // Proof-of-work: fetch a challenge and solve it (a brake on mass registration).
  const powRes = await fetch(
    `${AUTH_URL}/pow-challenge?username=${encodeURIComponent(username)}`,
  )
  if (!powRes.ok) throw new Error(translate('errors.registerFailed'))
  const { challenge, difficulty } = await powRes.json()
  onSolving?.()
  const powNonce = await solvePow(challenge, difficulty)

  const res = await postJson('register', {
    username,
    email,
    salt: toBase64(salt),
    recoverySalt: toBase64(recoverySalt),
    authVerifier: toBase64(keys.authKey),
    recAuthVerifier: toBase64(recKeys.authKey),
    wrappedDataKeyPw,
    wrappedDataKeyRec: await wrapDataKey(dataKey, recKeys.encKey),
    powChallenge: challenge,
    powNonce,
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || translate('errors.emailTaken'))
  }
  if (res.status === 400) throw new Error(translate('errors.invalidEmail'))
  if (!res.ok) throw new Error(translate('errors.registerFailed'))

  const { token, emailVerified: verified } = await res.json()
  emailVerified = verified ?? false
  cacheAuth(username, { salt: toBase64(salt), wrappedDataKeyPw })
  setSession(token, dataKey, keys.authKey, username)
  return recoveryCode
}

// Resend the verification e-mail (signed-in user).
export async function resendVerification(): Promise<void> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/send-verification`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(token ? { 'X-Auth-Token': token } : {}) },
  })
  if (!res.ok) throw new Error(translate('errors.sendFailed'))
}

// Verify the e-mail from the link (public – the user need not be signed in).
export async function verifyEmail(username: string, verifyToken: string): Promise<void> {
  const res = await postJson('verify-email', { username, token: verifyToken })
  if (!res.ok) throw new Error(translate('errors.linkInvalid'))
  emailVerified = true
}

export async function login(username: string, password: string): Promise<void> {
  // Try online first; if the network is unavailable, unlock from the offline cache.
  let saltRes: Response
  try {
    saltRes = await fetch(`${AUTH_URL}/salt?username=${encodeURIComponent(username)}`)
  } catch {
    return loginOffline(username, password)
  }
  if (!saltRes.ok) throw new Error(translate('errors.loginFailed'))
  const { salt } = await saltRes.json()

  const keys = await deriveKeys(password, fromBase64(salt))
  const res = await postJson('login', { username, authVerifier: toBase64(keys.authKey) })
  if (res.status === 401) throw new Error(translate('errors.wrongUserOrPass'))
  if (!res.ok) throw new Error(translate('errors.loginFailed'))

  const { token, wrappedDataKeyPw, emailVerified: verified } = await res.json()
  const dataKey = await unwrapDataKey(wrappedDataKeyPw, keys.encKey)
  emailVerified = verified ?? null
  cacheAuth(username, { salt, wrappedDataKeyPw }) // store for offline login
  setSession(token, dataKey, keys.authKey, username)
}

// Offline password login from locally stored auth material (no server call).
// Token is null → read-only.
async function loginOffline(username: string, password: string): Promise<void> {
  const material = getCachedAuth(username)
  if (!material) {
    throw new Error(translate('errors.offlineNoUser'))
  }
  const keys = await deriveKeys(password, fromBase64(material.salt))
  let dataKey: Uint8Array
  try {
    dataKey = await unwrapDataKey(material.wrappedDataKeyPw, keys.encKey)
  } catch {
    throw new Error(translate('errors.wrongUserOrPass'))
  }
  setSession(null, dataKey, keys.authKey, username)
}

// Re-login with just the authKey (biometric unlock – no password entered).
// We already have the dataKey from the local bundle. Offline → token null (read-only).
export async function loginWithAuthKey(
  username: string,
  authKey: Uint8Array,
  dataKey: Uint8Array,
): Promise<void> {
  let res: Response
  try {
    res = await postJson('login', { username, authVerifier: toBase64(authKey) })
  } catch {
    setSession(null, dataKey, authKey, username) // offline: read-only
    return
  }
  if (res.status === 401) throw new Error(translate('errors.savedLoginInvalid'))
  if (!res.ok) throw new Error(translate('errors.loginFailed'))
  const { token } = await res.json()
  setSession(token, dataKey, authKey, username)
}

export async function recover(
  username: string,
  recoveryCode: string,
  newPassword: string,
): Promise<void> {
  const matRes = await fetch(
    `${AUTH_URL}/recovery-material?username=${encodeURIComponent(username)}`,
  )
  if (matRes.status === 404) throw new Error(translate('errors.userNotFound'))
  if (!matRes.ok) throw new Error(translate('errors.recoverFailed'))
  const { recoverySalt, wrappedDataKeyRec } = await matRes.json()

  const recKeys = await deriveKeys(normalizeRecoveryCode(recoveryCode), fromBase64(recoverySalt))
  let dataKey: Uint8Array
  try {
    dataKey = await unwrapDataKey(wrappedDataKeyRec, recKeys.encKey)
  } catch {
    throw new Error(translate('errors.invalidRecovery'))
  }

  const newSalt = generateSalt()
  const newKeys = await deriveKeys(newPassword, newSalt)
  const newWrappedDataKeyPw = await wrapDataKey(dataKey, newKeys.encKey)
  const res = await postJson('recover', {
    username,
    recAuthVerifier: toBase64(recKeys.authKey),
    newSalt: toBase64(newSalt),
    newAuthVerifier: toBase64(newKeys.authKey),
    newWrappedDataKeyPw,
  })
  if (res.status === 401) throw new Error(translate('errors.invalidRecovery'))
  if (!res.ok) throw new Error(translate('errors.recoverFailed'))

  const { token } = await res.json()
  cacheAuth(username, { salt: toBase64(newSalt), wrappedDataKeyPw: newWrappedDataKeyPw })
  setSession(token, dataKey, newKeys.authKey, username)
}
