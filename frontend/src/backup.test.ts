import { describe, it, expect } from 'vitest'
import {
  serializeBackup,
  parseBackup,
  isEncrypted,
  encryptBackup,
  decryptBackup,
  contentOf,
  imagePath,
  newBackupKdf,
  deriveBackupKey,
  decryptBackupWithKey,
  diffAgainst,
  BACKUP_VERSION,
  type BackupNote,
  type BackupImage,
} from './backup'
import { encryptBytes } from './crypto'
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

describe('encryptBackup / decryptBackup', () => {
  it('round-trips the notes', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(enc.encrypted).toBe(true)
    expect(JSON.stringify(enc)).not.toContain('Groceries')
    const back = await decryptBackup(enc, 'correct horse battery staple')
    expect(back).toEqual({ notes: plain.notes, images: [] })
  }, 30_000)

  it('keeps the header readable in the clear', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(enc.username).toBe('jan')
    expect(enc.exported_at).toBe(plain.exported_at)
    expect(enc.kdf.iterations).toBe(3)
    expect(enc.kdf.memory_size).toBe(65536)
  }, 30_000)

  it('uses a fresh salt and IV every time', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const a = await encryptBackup(plain, 'correct horse battery staple')
    const b = await encryptBackup(plain, 'correct horse battery staple')
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.iv).not.toBe(b.iv)
  }, 60_000)

  it('rejects a wrong passphrase', async () => {
    const enc = await encryptBackup(
      serializeBackup([note], { username: 'jan' }),
      'right passphrase',
    )
    await expect(decryptBackup(enc, 'wrong passphrase')).rejects.toThrow(/passphrase/i)
  }, 60_000)

  it('rejects a corrupted ciphertext', async () => {
    const enc = await encryptBackup(
      serializeBackup([note], { username: 'jan' }),
      'right passphrase',
    )
    const corrupted = { ...enc, ct: enc.ct.slice(0, -8) + 'AAAAAAAA' }
    await expect(decryptBackup(corrupted, 'right passphrase')).rejects.toThrow(/passphrase/i)
  }, 60_000)

  it('survives a full parse round trip through text', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    const reparsed = parseBackup(JSON.stringify(enc))
    expect(isEncrypted(reparsed)).toBe(true)
    if (isEncrypted(reparsed)) {
      await expect(decryptBackup(reparsed, 'correct horse battery staple')).resolves.toEqual({
        notes: plain.notes,
        images: [],
      })
    }
  }, 30_000)
})

const image: BackupImage = {
  id: 'abc-123',
  content_type: 'image/webp',
  size_bytes: 48210,
  path: 'images/abc-123.webp',
}

describe('contentOf', () => {
  it('returns notes and images of a plain backup without a passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    await expect(contentOf(plain)).resolves.toEqual({ notes: plain.notes, images: [image] })
  })

  it('decrypts an encrypted backup with the passphrase', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    await expect(contentOf(enc, 'correct horse battery staple')).resolves.toEqual({
      notes: plain.notes,
      images: [image],
    })
  }, 30_000)

  it('refuses an encrypted backup with no passphrase', async () => {
    const enc = await encryptBackup(serializeBackup([note], { username: 'jan' }), 'a passphrase')
    await expect(contentOf(enc)).rejects.toThrow(/password-protected/i)
  }, 30_000)
})

describe('version 2 manifest', () => {
  it('defaults images to an empty array', () => {
    expect(serializeBackup([note], { username: 'jan' }).images).toEqual([])
  })

  it('writes version 2', () => {
    expect(serializeBackup([note], { username: 'jan' }).version).toBe(2)
  })

  it('round-trips the images array through text', () => {
    const text = JSON.stringify(serializeBackup([note], { username: 'jan', images: [image] }))
    const parsed = parseBackup(text)
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) expect(parsed.images).toEqual([image])
  })

  it('reads a version 1 file as a backup with no images', () => {
    const v1 = {
      format: 'bpad-backup',
      version: 1,
      exported_at: '2026-07-20T10:00:00Z',
      username: 'jan',
      encrypted: false,
      notes: [{ title: 'T', content: 'c', url: null, created_at: 'x', updated_at: 'x', tags: [] }],
    }
    const parsed = parseBackup(JSON.stringify(v1))
    expect(isEncrypted(parsed)).toBe(false)
    if (!isEncrypted(parsed)) {
      expect(parsed.images).toEqual([])
      expect(parsed.notes).toHaveLength(1)
    }
  })

  it('keeps the images array out of the encrypted header', async () => {
    const plain = serializeBackup([note], { username: 'jan', images: [image] })
    const enc = await encryptBackup(plain, 'correct horse battery staple')
    expect(JSON.stringify(enc)).not.toContain('abc-123')
  }, 30_000)

  it('reads a version 1 encrypted payload that has no images key', async () => {
    const plain = serializeBackup([note], { username: 'jan' })
    const kdf = newBackupKdf()
    const key = await deriveBackupKey('a passphrase here', kdf)
    // The historical wire shape: version 1 encrypted only ever wrote { notes }.
    const { iv, ct } = await encryptBytes(
      new TextEncoder().encode(JSON.stringify({ notes: plain.notes })),
      key,
    )
    const legacy = {
      format: 'bpad-backup' as const,
      version: 1,
      exported_at: plain.exported_at,
      username: 'jan',
      encrypted: true as const,
      kdf,
      cipher: 'AES-256-GCM' as const,
      iv,
      ct,
    }
    await expect(decryptBackupWithKey(legacy, key)).resolves.toEqual({
      notes: plain.notes,
      images: [],
    })
  }, 30_000)
})

describe('imagePath', () => {
  it('uses the extension that matches the content type', () => {
    expect(imagePath('abc', 'image/webp', false)).toBe('images/abc.webp')
    expect(imagePath('abc', 'image/jpeg', false)).toBe('images/abc.jpg')
    expect(imagePath('abc', 'image/png', false)).toBe('images/abc.png')
  })

  it('falls back to .bin for an unknown content type', () => {
    expect(imagePath('abc', 'application/weird', false)).toBe('images/abc.bin')
  })

  it('uses .bin for an encrypted archive whatever the content type', () => {
    expect(imagePath('abc', 'image/webp', true)).toBe('images/abc.bin')
  })
})

const incoming = (over: Partial<BackupNote> = {}): BackupNote => ({
  title: 'Groceries',
  content: '# Groceries\n\nmilk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
  ...over,
})

describe('diffAgainst', () => {
  it('imports everything into an empty vault', () => {
    const d = diffAgainst([], [incoming()])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(0)
  })

  it('treats a note with the same created_at and content as a duplicate', () => {
    const d = diffAgainst([note], [incoming()])
    expect(d.toImport).toHaveLength(0)
    expect(d.duplicates).toHaveLength(1)
  })

  it('splits a partial overlap', () => {
    const d = diffAgainst([note], [incoming(), incoming({ created_at: '2026-05-05T00:00:00Z' })])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(1)
  })

  it('does not treat the same content at a different time as a duplicate', () => {
    const d = diffAgainst([note], [incoming({ created_at: '2026-05-05T00:00:00Z' })])
    expect(d.toImport).toHaveLength(1)
  })

  it('does not treat different content at the same time as a duplicate', () => {
    const d = diffAgainst([note], [incoming({ content: 'something else' })])
    expect(d.toImport).toHaveLength(1)
  })

  it('keeps only the first of two identical incoming notes', () => {
    const d = diffAgainst([], [incoming(), incoming()])
    expect(d.toImport).toHaveLength(1)
    expect(d.duplicates).toHaveLength(1)
  })

  it('handles an empty backup', () => {
    expect(diffAgainst([note], [])).toEqual({ toImport: [], duplicates: [] })
  })
})
