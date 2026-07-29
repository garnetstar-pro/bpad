import { describe, it, expect } from 'vitest'
import { entryScreen } from './coldStart'

const base = {
  hasEnrollment: false,
  usePassword: false,
  wantsAuthForm: false,
  remembered: null as string | null,
}

describe('entryScreen', () => {
  it('shows the landing page to a first-time visitor', () => {
    expect(entryScreen(base)).toBe('landing')
  })

  it('shows the lock screen after a reload, not the landing page', () => {
    expect(entryScreen({ ...base, remembered: 'alice' })).toBe('lock')
  })

  it('prefers the fingerprint over the lock screen when enrolled', () => {
    expect(entryScreen({ ...base, hasEnrollment: true, remembered: 'alice' })).toBe('biometric')
  })

  it('falls back to the lock screen when the enrolled user picks a password', () => {
    expect(
      entryScreen({ ...base, hasEnrollment: true, usePassword: true, remembered: 'alice' }),
    ).toBe('lock')
  })

  it('shows the landing page for an enrolled user who picks a password but is unknown', () => {
    expect(entryScreen({ ...base, hasEnrollment: true, usePassword: true })).toBe('landing')
  })

  it('opens the auth form when the user asked for it — "log in as someone else"', () => {
    expect(entryScreen({ ...base, wantsAuthForm: true, remembered: 'alice' })).toBe('auth')
  })
})
