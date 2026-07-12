// Orchestruje klientskou kryptografii + volání auth API. Heslo ani klíče
// neopouštějí prohlížeč; na server jde jen verifier a obalený dataKey.
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

const AUTH_URL = import.meta.env.DEV ? 'http://localhost:7071/api/auth' : '/api/auth'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

// Stav ověření e-mailu z posledního loginu/registrace (null = neznámé, např.
// po biometrickém/offline odemčení). Čte ho App pro banner.
let emailVerified: boolean | null = null
export function getEmailVerified(): boolean | null {
  return emailVerified
}

// Údaje o přihlášeném účtu (ne-tajná metadata) pro profil uživatele.
export interface Account {
  username: string
  email: string | null
  emailVerified: boolean
  createdAt: string | null
}

export async function getAccount(): Promise<Account> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/me`, {
    headers: token ? { 'X-Auth-Token': token } : {},
  })
  if (!res.ok) throw new Error('Nepodařilo se načíst účet')
  return res.json()
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${AUTH_URL}/${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

// Registrace: vrací jednorázový recovery kód (ukázat uživateli). Session je po
// úspěchu nastavená (uživatel je fakticky přihlášený).
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

  // Proof-of-work: vyzvedni výzvu a vyřeš ji (brzda proti hromadné registraci).
  const powRes = await fetch(
    `${AUTH_URL}/pow-challenge?username=${encodeURIComponent(username)}`,
  )
  if (!powRes.ok) throw new Error('Registrace se nepovedla')
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
    throw new Error(body.error || 'Uživatelské jméno nebo e-mail je obsazený')
  }
  if (res.status === 400) throw new Error('Neplatný e-mail nebo údaje')
  if (!res.ok) throw new Error('Registrace se nepovedla')

  const { token, emailVerified: verified } = await res.json()
  emailVerified = verified ?? false
  cacheAuth(username, { salt: toBase64(salt), wrappedDataKeyPw })
  setSession(token, dataKey, keys.authKey, username)
  return recoveryCode
}

// Znovu poslat ověřovací e-mail (přihlášený uživatel).
export async function resendVerification(): Promise<void> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/send-verification`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...(token ? { 'X-Auth-Token': token } : {}) },
  })
  if (!res.ok) throw new Error('Odeslání se nepovedlo')
}

// Ověřit e-mail z odkazu (public – uživatel nemusí být přihlášený).
export async function verifyEmail(username: string, verifyToken: string): Promise<void> {
  const res = await postJson('verify-email', { username, token: verifyToken })
  if (!res.ok) throw new Error('Odkaz je neplatný nebo vypršel')
  emailVerified = true
}

export async function login(username: string, password: string): Promise<void> {
  // Zkusíme online; když je síť nedostupná, odemkneme z offline cache.
  let saltRes: Response
  try {
    saltRes = await fetch(`${AUTH_URL}/salt?username=${encodeURIComponent(username)}`)
  } catch {
    return loginOffline(username, password)
  }
  if (!saltRes.ok) throw new Error('Přihlášení se nepovedlo')
  const { salt } = await saltRes.json()

  const keys = await deriveKeys(password, fromBase64(salt))
  const res = await postJson('login', { username, authVerifier: toBase64(keys.authKey) })
  if (res.status === 401) throw new Error('Špatné jméno nebo heslo')
  if (!res.ok) throw new Error('Přihlášení se nepovedlo')

  const { token, wrappedDataKeyPw, emailVerified: verified } = await res.json()
  const dataKey = await unwrapDataKey(wrappedDataKeyPw, keys.encKey)
  emailVerified = verified ?? null
  cacheAuth(username, { salt, wrappedDataKeyPw }) // uložit pro offline přihlášení
  setSession(token, dataKey, keys.authKey, username)
}

// Offline přihlášení heslem z lokálně uloženého auth materiálu (bez serveru).
// Token je null → jen čtení.
async function loginOffline(username: string, password: string): Promise<void> {
  const material = getCachedAuth(username)
  if (!material) {
    throw new Error('Jsi offline a pro tohoto uživatele nemám uložená data.')
  }
  const keys = await deriveKeys(password, fromBase64(material.salt))
  let dataKey: Uint8Array
  try {
    dataKey = await unwrapDataKey(material.wrappedDataKeyPw, keys.encKey)
  } catch {
    throw new Error('Špatné jméno nebo heslo')
  }
  setSession(null, dataKey, keys.authKey, username)
}

// Re-login jen s authKey (biometrické odemčení – heslo se nezadává).
// dataKey už máme z lokálního balíku. Offline → token null (jen čtení).
export async function loginWithAuthKey(
  username: string,
  authKey: Uint8Array,
  dataKey: Uint8Array,
): Promise<void> {
  let res: Response
  try {
    res = await postJson('login', { username, authVerifier: toBase64(authKey) })
  } catch {
    setSession(null, dataKey, authKey, username) // offline: jen čtení
    return
  }
  if (res.status === 401) throw new Error('Uložené přihlášení už neplatí')
  if (!res.ok) throw new Error('Přihlášení se nepovedlo')
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
  if (matRes.status === 404) throw new Error('Uživatel nenalezen')
  if (!matRes.ok) throw new Error('Obnova se nepovedla')
  const { recoverySalt, wrappedDataKeyRec } = await matRes.json()

  const recKeys = await deriveKeys(normalizeRecoveryCode(recoveryCode), fromBase64(recoverySalt))
  let dataKey: Uint8Array
  try {
    dataKey = await unwrapDataKey(wrappedDataKeyRec, recKeys.encKey)
  } catch {
    throw new Error('Neplatný recovery kód')
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
  if (res.status === 401) throw new Error('Neplatný recovery kód')
  if (!res.ok) throw new Error('Obnova se nepovedla')

  const { token } = await res.json()
  cacheAuth(username, { salt: toBase64(newSalt), wrappedDataKeyPw: newWrappedDataKeyPw })
  setSession(token, dataKey, newKeys.authKey, username)
}
