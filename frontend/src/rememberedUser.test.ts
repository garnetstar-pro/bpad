import { describe, it, expect, beforeEach } from 'vitest'
import { rememberUser, getRememberedUser, forgetRememberedUser } from './rememberedUser'

// vitest runs in the node environment (no DOM); stub localStorage with a Map,
// mirroring preferences.test.ts.
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

describe('remembered user', () => {
  beforeEach(() => store.clear())

  it('returns null when nobody has logged in on this device', () => {
    expect(getRememberedUser()).toBeNull()
  })

  it('round-trips a username', () => {
    rememberUser('alice')
    expect(getRememberedUser()).toBe('alice')
  })

  it('forgets on request, so "log in as someone else" reaches the landing page', () => {
    rememberUser('alice')
    forgetRememberedUser()
    expect(getRememberedUser()).toBeNull()
  })

  it('treats an empty stored value as nobody', () => {
    localStorage.setItem('bpad.lastUser', '')
    expect(getRememberedUser()).toBeNull()
  })
})
