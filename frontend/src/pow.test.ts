import { describe, it, expect } from 'vitest'
import { countLeadingZeroBits, findNonce } from './pow'

describe('countLeadingZeroBits', () => {
  it('counts zero bits across bytes', () => {
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0)
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8)
    expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4)
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16)
  })
})

describe('findNonce', () => {
  it('returns "0" immediately when difficulty is 0', async () => {
    expect(await findNonce('challenge', 0)).toBe('0')
  })

  it('finds a nonce meeting a low difficulty', async () => {
    const difficulty = 10
    const nonce = await findNonce('some-challenge', difficulty)
    // verify the returned nonce actually satisfies the target
    const buf = new TextEncoder().encode('some-challenge' + nonce)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
    expect(countLeadingZeroBits(digest)).toBeGreaterThanOrEqual(difficulty)
  })

  it('gives up after maxAttempts instead of looping forever', async () => {
    // 64 bits is practically unreachable in 500 attempts → must give up with an error
    await expect(findNonce('x', 64, 500)).rejects.toThrow(/taking too long|try again/i)
  })
})
