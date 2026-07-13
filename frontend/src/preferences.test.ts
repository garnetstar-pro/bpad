import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSortPref, setSortPref } from './preferences'

// vitest runs in the node environment (no DOM); stub localStorage with a Map,
// mirroring offlineCache.test.ts.
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

vi.mock('./session', () => ({ getUsername: () => 'alice' }))

describe('sort preference cache', () => {
  beforeEach(() => store.clear())

  it('defaults to "created" when nothing is stored', () => {
    expect(getSortPref()).toBe('created')
  })

  it('round-trips a stored value', () => {
    setSortPref('modified')
    expect(getSortPref()).toBe('modified')
  })

  it('falls back to "created" for an unrecognized stored value', () => {
    localStorage.setItem('bpad.pref.sort.alice', 'garbage')
    expect(getSortPref()).toBe('created')
  })
})
