import { describe, it, expect, beforeEach, vi } from 'vitest'

// PRF klíč (32 B pro AES-256) a mock re-loginu – přes vi.hoisted, ať jsou
// dostupné v hoistnutých vi.mock factory.
const mocks = vi.hoisted(() => ({
  PRF_KEY: new Uint8Array(32).fill(7),
  loginWithAuthKey: vi.fn(),
}))
const loginWithAuthKey = mocks.loginWithAuthKey

vi.mock('./webauthn', () => ({
  isBiometricAvailable: vi.fn().mockResolvedValue(true),
  enroll: vi.fn().mockResolvedValue({ credentialId: 'cred-1', prfKey: mocks.PRF_KEY }),
  getPrfKey: vi.fn().mockResolvedValue(mocks.PRF_KEY),
}))

vi.mock('./authApi', () => ({ loginWithAuthKey: mocks.loginWithAuthKey }))

import { setSession } from './session'
import { toBase64 } from './crypto'
import * as biometric from './biometric'
import * as webauthn from './webauthn'

// jednoduchý in-memory localStorage
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const AUTH = new Uint8Array(32).fill(1)
const DATA = new Uint8Array(32).fill(2)

beforeEach(() => {
  store.clear()
  loginWithAuthKey.mockClear()
  setSession('token', DATA, AUTH, 'alice')
})

describe('biometric enroll + unlock', () => {
  it('has no enrollment initially', () => {
    expect(biometric.hasEnrollment()).toBe(false)
  })

  it('enrolls and stores only ciphertext (no plaintext keys)', async () => {
    await biometric.enroll('alice')
    expect(biometric.hasEnrollment()).toBe(true)
    const raw = store.get('bpad.biometric')!
    expect(raw).not.toContain(toBase64(AUTH))
    expect(raw).not.toContain(toBase64(DATA))
    expect(JSON.parse(raw).credentialId).toBe('cred-1')
  })

  it('unlocks by decrypting keys and re-logging in with them', async () => {
    await biometric.enroll('alice')
    const username = await biometric.unlock()
    expect(username).toBe('alice')
    expect(loginWithAuthKey).toHaveBeenCalledTimes(1)
    const [u, authArg, dataArg] = loginWithAuthKey.mock.calls[0]
    expect(u).toBe('alice')
    expect(toBase64(authArg as Uint8Array)).toBe(toBase64(AUTH))
    expect(toBase64(dataArg as Uint8Array)).toBe(toBase64(DATA))
  })

  it('fails to unlock if the PRF key is wrong', async () => {
    await biometric.enroll('alice')
    vi.mocked(webauthn.getPrfKey).mockResolvedValueOnce(new Uint8Array(32).fill(9))
    await expect(biometric.unlock()).rejects.toThrow()
  })

  it('forgets the enrollment', async () => {
    await biometric.enroll('alice')
    biometric.forget()
    expect(biometric.hasEnrollment()).toBe(false)
  })
})
