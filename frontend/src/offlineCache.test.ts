import { describe, it, expect, beforeEach } from 'vitest'
import {
  cacheNotes,
  getCachedNotes,
  upsertCachedNote,
  removeCachedNote,
  cacheAuth,
  getCachedAuth,
  type EncryptedNote,
} from './offlineCache'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const note = (id: string): EncryptedNote => ({ id, iv: 'iv', ct: 'ct-' + id, created_at: '' })

beforeEach(() => store.clear())

describe('offline notes cache', () => {
  it('returns null when nothing is cached', () => {
    expect(getCachedNotes('alice')).toBeNull()
  })

  it('caches and reads notes per user', () => {
    cacheNotes('alice', [note('1')])
    expect(getCachedNotes('alice')).toHaveLength(1)
    expect(getCachedNotes('bob')).toBeNull()
  })

  it('upserts a new note to the front and updates an existing one', () => {
    cacheNotes('alice', [note('1')])
    upsertCachedNote('alice', note('2'))
    expect(getCachedNotes('alice')!.map((n) => n.id)).toEqual(['2', '1'])
    upsertCachedNote('alice', { ...note('1'), ct: 'changed' })
    expect(getCachedNotes('alice')!.find((n) => n.id === '1')!.ct).toBe('changed')
  })

  it('removes a note', () => {
    cacheNotes('alice', [note('1'), note('2')])
    removeCachedNote('alice', '1')
    expect(getCachedNotes('alice')!.map((n) => n.id)).toEqual(['2'])
  })
})

describe('offline auth material cache', () => {
  it('round-trips salt + wrapped data key', () => {
    cacheAuth('alice', { salt: 's', wrappedDataKeyPw: { iv: 'i', ct: 'c' } })
    expect(getCachedAuth('alice')).toEqual({ salt: 's', wrappedDataKeyPw: { iv: 'i', ct: 'c' } })
  })
})
