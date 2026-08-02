import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_MAX_IMAGES_PER_NOTE,
  getMaxImagesPerNote,
  setMaxImagesPerNote,
} from './entitlements'

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

// Mutable so a test can switch users; hoisted, because vi.mock runs first.
const session = vi.hoisted(() => ({ username: 'alice' as string | null }))
vi.mock('./session', () => ({ getUsername: () => session.username }))

describe('images-per-note quota cache', () => {
  beforeEach(() => {
    store.clear()
    session.username = 'alice'
  })

  it('defaults to 10 when nothing is stored', () => {
    expect(DEFAULT_MAX_IMAGES_PER_NOTE).toBe(10)
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('round-trips a stored value', () => {
    setMaxImagesPerNote(25)
    expect(getMaxImagesPerNote()).toBe(25)
  })

  it('keeps each user’s quota separate', () => {
    setMaxImagesPerNote(25)
    session.username = 'bob'
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('falls back to the default for a junk stored value', () => {
    store.set('bpad.limit.images.alice', 'lots')
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('falls back to the default when signed out', () => {
    session.username = null
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('ignores a write while signed out', () => {
    session.username = null
    setMaxImagesPerNote(25)
    session.username = 'alice'
    expect(getMaxImagesPerNote()).toBe(10)
  })
})
