import { describe, it, expect, vi, afterEach } from 'vitest'
import { backupFilename, downloadBackup, readTextFile } from './backupFile'
import { serializeBackup } from './backup'
import type { Note } from './types'

const note: Note = {
  id: 'x',
  title: 'T',
  content: 'c',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: [],
}

const plain = () =>
  serializeBackup([note], { username: 'jan', exportedAt: '2026-07-20T10:00:00Z' })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('backupFilename', () => {
  it('uses the .json extension for a plain backup', () => {
    expect(backupFilename(plain())).toBe('bpad-backup-2026-07-20.json')
  })

  it('uses the .bpad extension for an encrypted backup', () => {
    const enc = {
      ...plain(),
      encrypted: true as const,
      kdf: {
        algorithm: 'argon2id' as const,
        salt: '',
        iterations: 3,
        memory_size: 65536,
        parallelism: 1,
        hash_length: 32,
      },
      cipher: 'AES-256-GCM' as const,
      iv: '',
      ct: '',
    }
    expect(backupFilename(enc)).toBe('bpad-backup-2026-07-20.bpad')
  })
})

// The suite runs in plain Node, so the handful of DOM calls are stubbed
// rather than pulling in jsdom for one test.
describe('downloadBackup', () => {
  it('clicks an anchor pointing at a blob URL and revokes it', () => {
    const anchor = { click: vi.fn(), href: '', download: '' }
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(anchor) })
    const createObjectURL = vi.fn().mockReturnValue('blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadBackup(plain())

    expect(createObjectURL).toHaveBeenCalled()
    expect(anchor.href).toBe('blob:fake')
    expect(anchor.download).toBe('bpad-backup-2026-07-20.json')
    expect(anchor.click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('writes the backup as the blob contents', async () => {
    let captured: Blob | null = null
    vi.stubGlobal('document', { createElement: () => ({ click: () => {}, href: '', download: '' }) })
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        captured = b
        return 'blob:fake'
      },
      revokeObjectURL: () => {},
    })

    downloadBackup(plain())

    expect(captured).not.toBeNull()
    expect(JSON.parse(await captured!.text()).notes[0].title).toBe('T')
  })
})

describe('readTextFile', () => {
  it('resolves with the file contents', async () => {
    const f = new File(['{"hello":1}'], 'b.json', { type: 'application/json' })
    await expect(readTextFile(f)).resolves.toBe('{"hello":1}')
  })
})
