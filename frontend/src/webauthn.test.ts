import { describe, it, expect } from 'vitest'
import { isUnsupportedError, friendlyError } from './webauthn'

describe('isUnsupportedError', () => {
  it('treats SecurityError as unsupported', () => {
    expect(isUnsupportedError({ name: 'SecurityError' })).toBe(true)
  })

  it('treats NotSupportedError as unsupported', () => {
    expect(isUnsupportedError({ name: 'NotSupportedError' })).toBe(true)
  })

  it('treats the TLS-certificate message as unsupported', () => {
    expect(
      isUnsupportedError({
        name: 'SecurityError',
        message: 'WebAuthn is not supported on sites with TLS certificate errors.',
      }),
    ).toBe(true)
  })

  it('does NOT treat a user cancel (NotAllowedError) as unsupported', () => {
    expect(isUnsupportedError({ name: 'NotAllowedError' })).toBe(false)
  })

  it('friendlyError hints at the certificate for unsupported errors', () => {
    expect(friendlyError({ name: 'SecurityError' })).toMatch(/certifik/i)
  })
})
