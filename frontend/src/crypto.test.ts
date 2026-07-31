import { describe, it, expect } from 'vitest'
import {
  deriveKeys,
  generateSalt,
  generateDataKey,
  generateRecoveryCode,
  normalizeRecoveryCode,
  wrapDataKey,
  unwrapDataKey,
  encryptJSON,
  decryptJSON,
  toBase64,
  sealBytes,
  openBytes,
} from './crypto'

const sameBytes = (a: Uint8Array, b: Uint8Array) => toBase64(a) === toBase64(b)

describe('deriveKeys', () => {
  it('is deterministic for the same password and salt', async () => {
    const salt = generateSalt()
    const a = await deriveKeys('correct horse', salt)
    const b = await deriveKeys('correct horse', salt)
    expect(sameBytes(a.encKey, b.encKey)).toBe(true)
    expect(sameBytes(a.authKey, b.authKey)).toBe(true)
  })

  it('derives distinct enc and auth keys', async () => {
    const k = await deriveKeys('pw', generateSalt())
    expect(sameBytes(k.encKey, k.authKey)).toBe(false)
  })

  it('produces different keys for a different password', async () => {
    const salt = generateSalt()
    const a = await deriveKeys('pw-one', salt)
    const b = await deriveKeys('pw-two', salt)
    expect(sameBytes(a.encKey, b.encKey)).toBe(false)
  })

  it('produces different keys for a different salt', async () => {
    const a = await deriveKeys('pw', generateSalt())
    const b = await deriveKeys('pw', generateSalt())
    expect(sameBytes(a.encKey, b.encKey)).toBe(false)
  })
})

describe('note payload encryption', () => {
  it('round-trips a JSON payload', async () => {
    const dataKey = generateDataKey()
    const payload = { title: 'Tajný název', content: '# Nadpis\ntělo', url: null }
    const enc = await encryptJSON(payload, dataKey)
    expect(await decryptJSON(enc, dataKey)).toEqual(payload)
  })

  it('does not leak plaintext into the ciphertext', async () => {
    const dataKey = generateDataKey()
    const enc = await encryptJSON({ title: 'HESLO123' }, dataKey)
    expect(enc.ct.includes('HESLO')).toBe(false)
  })

  it('uses a fresh IV each time', async () => {
    const dataKey = generateDataKey()
    const a = await encryptJSON({ x: 1 }, dataKey)
    const b = await encryptJSON({ x: 1 }, dataKey)
    expect(a.iv).not.toBe(b.iv)
  })

  it('fails to decrypt with the wrong key', async () => {
    const enc = await encryptJSON({ x: 1 }, generateDataKey())
    await expect(decryptJSON(enc, generateDataKey())).rejects.toThrow()
  })
})

describe('wrapped data key (password + recovery)', () => {
  it('unwraps the data key with the password-derived key', async () => {
    const dataKey = generateDataKey()
    const keys = await deriveKeys('master', generateSalt())
    const wrapped = await wrapDataKey(dataKey, keys.encKey)
    expect(sameBytes(await unwrapDataKey(wrapped, keys.encKey), dataKey)).toBe(true)
  })

  it('unwraps the same data key with the recovery-derived key', async () => {
    const dataKey = generateDataKey()
    const code = generateRecoveryCode()
    const recKeys = await deriveKeys(normalizeRecoveryCode(code), generateSalt())
    const wrapped = await wrapDataKey(dataKey, recKeys.encKey)
    expect(sameBytes(await unwrapDataKey(wrapped, recKeys.encKey), dataKey)).toBe(true)
  })

  it('fails to unwrap with a wrong key', async () => {
    const wrapped = await wrapDataKey(generateDataKey(), (await deriveKeys('a', generateSalt())).encKey)
    const other = await deriveKeys('b', generateSalt())
    await expect(unwrapDataKey(wrapped, other.encKey)).rejects.toThrow()
  })
})

describe('generateRecoveryCode', () => {
  it('is grouped base32 with enough entropy', () => {
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4})+$/)
  })

  it('normalizes user input (dashes, spaces, case)', () => {
    expect(normalizeRecoveryCode('abcd-ef gh')).toBe('ABCDEFGH')
  })
})

describe('sealBytes / openBytes', () => {
  const key = new Uint8Array(32).fill(7)

  it('round-trips binary data', async () => {
    const data = new Uint8Array([0, 1, 2, 250, 251, 255])
    const sealed = await sealBytes(data, key)
    await expect(openBytes(sealed, key)).resolves.toEqual(data)
  })

  it('carries the IV in the first 12 bytes and the tag on the end', async () => {
    const data = new Uint8Array(100)
    const sealed = await sealBytes(data, key)
    // 12-byte IV + 100 bytes of ciphertext + 16-byte GCM tag
    expect(sealed.length).toBe(128)
  })

  it('uses a fresh IV every time', async () => {
    const data = new Uint8Array([1, 2, 3])
    const a = await sealBytes(data, key)
    const b = await sealBytes(data, key)
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12))
  })

  it('rejects the wrong key', async () => {
    const sealed = await sealBytes(new Uint8Array([1, 2, 3]), key)
    await expect(openBytes(sealed, new Uint8Array(32).fill(8))).rejects.toThrow()
  })

  it('rejects a payload too short to hold an IV and a tag', async () => {
    await expect(openBytes(new Uint8Array(10), key)).rejects.toThrow(/too short/i)
  })
})
