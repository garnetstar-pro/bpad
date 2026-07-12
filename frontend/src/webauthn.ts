// Low-level WebAuthn / PRF layer. The PRF output (32 B) is a stable secret
// bound to the platform authenticator, issued only after user verification
// (biometrics).
import { fromBase64, toBase64, randomBytes } from './crypto'
import { translate } from './i18n'

const PRF_SALT = new TextEncoder().encode('bpad-prf-v1')

// Web Crypto/WebAuthn want a BufferSource over an ArrayBuffer.
function ab(u: Uint8Array): ArrayBuffer {
  const b = new ArrayBuffer(u.byteLength)
  new Uint8Array(b).set(u)
  return b
}

// WebAuthn doesn't work in this context (unsupported, certificate error, …).
// Distinguished from NotAllowedError (user cancelled / timeout).
export function isUnsupportedError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? ''
  const msg = (err as { message?: string } | null)?.message ?? ''
  return (
    name === 'SecurityError' ||
    name === 'NotSupportedError' ||
    name === 'InvalidStateError' ||
    /not supported|certificate|secure context/i.test(msg)
  )
}

export function friendlyError(err: unknown): string {
  if (isUnsupportedError(err)) {
    return 'Biometrika v tomto prohlížeči nefunguje (nejspíš kvůli certifikátu). Přihlas se heslem.'
  }
  return 'Ověření se nepovedlo. Zkus to znovu nebo použij heslo.'
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

// Creates a platform credential with PRF and returns the id + PRF secret.
export async function enroll(username: string): Promise<{ credentialId: string; prfKey: Uint8Array }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: ab(randomBytes(32)),
      rp: { name: 'bpad', id: location.hostname },
      user: {
        id: ab(new TextEncoder().encode(username)),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
      timeout: 60000,
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error(translate('errors.biometricEnrollFailed'))

  const credentialId = toBase64(new Uint8Array(cred.rawId))
  // Read the PRF secret via an assertion (more reliable across platforms).
  const prfKey = await getPrfKey(credentialId)
  return { credentialId, prfKey }
}

export async function getPrfKey(credentialId: string): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: ab(randomBytes(32)),
      allowCredentials: [{ type: 'public-key', id: ab(fromBase64(credentialId)) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: ab(PRF_SALT) } } },
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error(translate('errors.biometricUnlockFailed'))

  const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  const first = ext.prf?.results?.first
  if (!first) throw new Error(translate('errors.noPrfSupport'))
  return new Uint8Array(first)
}
