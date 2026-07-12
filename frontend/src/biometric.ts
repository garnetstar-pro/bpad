// Orchestrace biometrického odemykání: zabalí klíče trezoru PRF klíčem a uloží
// je (jen jako šifru) do localStorage; při odemčení je odbalí a re-loginem
// obnoví session. Heslo se nikdy neukládá.
import { encryptJSON, decryptJSON, toBase64, fromBase64 } from './crypto'
import { getAuthKey, getDataKey } from './session'
import { loginWithAuthKey } from './authApi'
import * as webauthn from './webauthn'

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

// Zapnout na tomto zařízení (uživatel je přihlášený).
export async function enroll(username: string): Promise<void> {
  const authKey = getAuthKey()
  const dataKey = getDataKey()
  if (!authKey || !dataKey) throw new Error('Trezor není odemčený')

  const { credentialId, prfKey } = await webauthn.enroll(username)
  const payload: StoredKeys = { authKey: toBase64(authKey), dataKey: toBase64(dataKey) }
  const wrapped = await encryptJSON(payload, prfKey)

  const enrollment: Enrollment = { username, credentialId, wrapped }
  localStorage.setItem(STORE_KEY, JSON.stringify(enrollment))
  localStorage.removeItem(DECLINED_KEY)
}

// Odemknout otiskem: vrátí username přihlášeného uživatele.
export async function unlock(): Promise<string> {
  const enrollment = getEnrollment()
  if (!enrollment) throw new Error('Žádné biometrické přihlášení')

  const prfKey = await webauthn.getPrfKey(enrollment.credentialId)
  let keys: StoredKeys
  try {
    keys = await decryptJSON<StoredKeys>(enrollment.wrapped, prfKey)
  } catch {
    throw new Error('Biometrické odemčení selhalo')
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
