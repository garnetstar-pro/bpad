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
import { setSession } from './session'

const AUTH_URL = import.meta.env.DEV ? 'http://localhost:7071/api/auth' : '/api/auth'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${AUTH_URL}/${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
}

// Registrace: vrací jednorázový recovery kód (ukázat uživateli). Session je po
// úspěchu nastavená (uživatel je fakticky přihlášený).
export async function register(username: string, password: string): Promise<string> {
  const salt = generateSalt()
  const recoverySalt = generateSalt()
  const recoveryCode = generateRecoveryCode()

  const keys = await deriveKeys(password, salt)
  const recKeys = await deriveKeys(normalizeRecoveryCode(recoveryCode), recoverySalt)
  const dataKey = generateDataKey()

  const res = await postJson('register', {
    username,
    salt: toBase64(salt),
    recoverySalt: toBase64(recoverySalt),
    authVerifier: toBase64(keys.authKey),
    recAuthVerifier: toBase64(recKeys.authKey),
    wrappedDataKeyPw: await wrapDataKey(dataKey, keys.encKey),
    wrappedDataKeyRec: await wrapDataKey(dataKey, recKeys.encKey),
  })
  if (res.status === 409) throw new Error('Uživatelské jméno je obsazené')
  if (!res.ok) throw new Error('Registrace se nepovedla')

  const { token } = await res.json()
  setSession(token, dataKey)
  return recoveryCode
}

export async function login(username: string, password: string): Promise<void> {
  const saltRes = await fetch(`${AUTH_URL}/salt?username=${encodeURIComponent(username)}`)
  if (!saltRes.ok) throw new Error('Přihlášení se nepovedlo')
  const { salt } = await saltRes.json()

  const keys = await deriveKeys(password, fromBase64(salt))
  const res = await postJson('login', { username, authVerifier: toBase64(keys.authKey) })
  if (res.status === 401) throw new Error('Špatné jméno nebo heslo')
  if (!res.ok) throw new Error('Přihlášení se nepovedlo')

  const { token, wrappedDataKeyPw } = await res.json()
  const dataKey = await unwrapDataKey(wrappedDataKeyPw, keys.encKey)
  setSession(token, dataKey)
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
  const res = await postJson('recover', {
    username,
    recAuthVerifier: toBase64(recKeys.authKey),
    newSalt: toBase64(newSalt),
    newAuthVerifier: toBase64(newKeys.authKey),
    newWrappedDataKeyPw: await wrapDataKey(dataKey, newKeys.encKey),
  })
  if (res.status === 401) throw new Error('Neplatný recovery kód')
  if (!res.ok) throw new Error('Obnova se nepovedla')

  const { token } = await res.json()
  setSession(token, dataKey)
}
