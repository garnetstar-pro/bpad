import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub localStorage (tests run in Node without jsdom).
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

// Stub session username.
vi.mock('./session', () => ({ getUsername: () => 'alice' }))

// Stub isTouchPrimary — default: desktop (false).
let mockIsTouch = false
vi.mock('./device', () => ({ isTouchPrimary: () => mockIsTouch }))

import {
  getAutoLockPref,
  setAutoLockPref,
  deviceDefaultAutoLock,
} from './preferences'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
  mockIsTouch = false
})

describe('deviceDefaultAutoLock', () => {
  it('returns 5 on desktop', () => {
    mockIsTouch = false
    expect(deviceDefaultAutoLock()).toBe(5)
  })

  it('returns null on touch device', () => {
    mockIsTouch = true
    expect(deviceDefaultAutoLock()).toBeNull()
  })
})

describe('getAutoLockPref', () => {
  it('returns device default when nothing stored', () => {
    mockIsTouch = false
    expect(getAutoLockPref()).toBe(5)
  })

  it('returns stored value when present', () => {
    setAutoLockPref(30)
    expect(getAutoLockPref()).toBe(30)
  })

  it('returns null (never) when 0 stored', () => {
    setAutoLockPref(0)
    expect(getAutoLockPref()).toBeNull()
  })
})

describe('setAutoLockPref', () => {
  it('persists minutes to localStorage', () => {
    setAutoLockPref(15)
    expect(getAutoLockPref()).toBe(15)
  })

  it('persists null (never) as sentinel 0', () => {
    setAutoLockPref(null)
    expect(getAutoLockPref()).toBeNull()
  })
})
