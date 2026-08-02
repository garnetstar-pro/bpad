import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCachedImage, putCachedImage, clearImageCache } from './imageCache'

const MIB = 1024 * 1024
const revokeObjectURL = vi.fn()

beforeEach(() => {
  revokeObjectURL.mockClear()
  vi.stubGlobal('URL', { revokeObjectURL })
})

afterEach(() => {
  // Clear before unstubbing: clearing revokes, and revoke is the stub.
  clearImageCache()
  vi.unstubAllGlobals()
})

describe('imageCache', () => {
  it('returns what was put in and undefined for an unknown id', () => {
    putCachedImage('a', 'blob:a', 10)
    expect(getCachedImage('a')).toBe('blob:a')
    expect(getCachedImage('nope')).toBeUndefined()
  })

  it('evicts the least recently used entry once the cap is exceeded', () => {
    putCachedImage('a', 'blob:a', 10 * MIB)
    putCachedImage('b', 'blob:b', 10 * MIB)
    putCachedImage('c', 'blob:c', 10 * MIB) // 30 MiB > 24 MiB cap
    expect(getCachedImage('a')).toBeUndefined()
    expect(getCachedImage('b')).toBe('blob:b')
    expect(getCachedImage('c')).toBe('blob:c')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a')
  })

  it('a read protects an entry from the next eviction', () => {
    putCachedImage('a', 'blob:a', 10 * MIB)
    putCachedImage('b', 'blob:b', 10 * MIB)
    getCachedImage('a') // 'a' is now the most recently used
    putCachedImage('c', 'blob:c', 10 * MIB)
    expect(getCachedImage('b')).toBeUndefined()
    expect(getCachedImage('a')).toBe('blob:a')
  })

  it('keeps an entry that exceeds the cap on its own', () => {
    putCachedImage('big', 'blob:big', 40 * MIB)
    expect(getCachedImage('big')).toBe('blob:big')
  })

  it('revokes the previous url when the same id is replaced', () => {
    putCachedImage('a', 'blob:old', 10)
    putCachedImage('a', 'blob:new', 10)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old')
    expect(getCachedImage('a')).toBe('blob:new')
  })

  it('revokes every url when cleared', () => {
    putCachedImage('a', 'blob:a', 10)
    putCachedImage('b', 'blob:b', 10)
    clearImageCache()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:a')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:b')
    expect(getCachedImage('a')).toBeUndefined()
  })

  it('frees its accounting on clear, so the cap applies afresh', () => {
    putCachedImage('a', 'blob:a', 20 * MIB)
    clearImageCache()
    putCachedImage('b', 'blob:b', 10 * MIB)
    putCachedImage('c', 'blob:c', 10 * MIB)
    expect(getCachedImage('b')).toBe('blob:b') // would have been evicted if the 20 MiB still counted
  })
})
