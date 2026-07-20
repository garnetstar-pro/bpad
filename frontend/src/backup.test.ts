import { describe, it, expect } from 'vitest'
import { serializeBackup, parseBackup, isEncrypted, BACKUP_VERSION } from './backup'
import type { Note } from './types'

const note: Note = {
  id: 'server-side-id',
  title: 'Groceries',
  content: '# Groceries\n\nmilk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
}

describe('serializeBackup', () => {
  it('writes the header and the notes', () => {
    const b = serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' })
    expect(b.format).toBe('bpad-backup')
    expect(b.version).toBe(BACKUP_VERSION)
    expect(b.username).toBe('jan')
    expect(b.exported_at).toBe('2026-07-20T10:00:00Z')
    expect(b.encrypted).toBe(false)
    expect(b.notes).toHaveLength(1)
  })

  it('drops the server-side id', () => {
    const b = serializeBackup([note], { username: 'jan' })
    expect(b.notes[0]).not.toHaveProperty('id')
  })

  it('keeps every user-visible field', () => {
    const b = serializeBackup([note], { username: 'jan' })
    expect(b.notes[0]).toEqual({
      title: 'Groceries',
      content: '# Groceries\n\nmilk',
      url: null,
      created_at: '2026-01-02T03:04:05Z',
      updated_at: '2026-01-03T03:04:05Z',
      tags: ['home'],
    })
  })

  it('handles an empty vault', () => {
    expect(serializeBackup([], { username: 'jan' }).notes).toEqual([])
  })
})

describe('parseBackup', () => {
  it('round-trips a plain backup', () => {
    const text = JSON.stringify(serializeBackup([note], { username: 'jan' }))
    const parsed = parseBackup(text)
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) expect(parsed.notes[0].title).toBe('Groceries')
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseBackup('not json at all')).toThrow(/couldn’t be read/i)
  })

  it('rejects JSON that is not a bpad backup', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(/bpad backup file/i)
  })

  it('rejects a version from the future', () => {
    const b = { ...serializeBackup([note], { username: 'jan' }), version: 99 }
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/newer version/i)
  })

  it('rejects a plain backup whose notes are missing', () => {
    const b = { ...serializeBackup([note], { username: 'jan' }), notes: undefined }
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/damaged/i)
  })

  it('recognises an encrypted backup by its flag, not its extension', () => {
    const parsed = parseBackup(
      JSON.stringify({
        format: 'bpad-backup',
        version: 1,
        exported_at: '2026-07-20T10:00:00Z',
        username: 'jan',
        encrypted: true,
        kdf: {
          algorithm: 'argon2id',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          iterations: 3,
          memory_size: 65536,
          parallelism: 1,
          hash_length: 32,
        },
        cipher: 'AES-256-GCM',
        iv: 'AAAAAAAAAAAAAAAA',
        ct: 'AAAA',
      }),
    )
    expect(isEncrypted(parsed)).toBe(true)
  })

  it('rejects an encrypted backup with an unknown KDF', () => {
    const bad = {
      format: 'bpad-backup',
      version: 1,
      exported_at: '2026-07-20T10:00:00Z',
      username: 'jan',
      encrypted: true,
      kdf: {
        algorithm: 'scrypt',
        salt: 'AA==',
        iterations: 3,
        memory_size: 1,
        parallelism: 1,
        hash_length: 32,
      },
      cipher: 'AES-256-GCM',
      iv: 'AA==',
      ct: 'AA==',
    }
    expect(() => parseBackup(JSON.stringify(bad))).toThrow(/unsupported/i)
  })
})
