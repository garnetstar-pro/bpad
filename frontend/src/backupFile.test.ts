import { describe, it, expect, vi, afterEach } from 'vitest'
import { archiveFilename, downloadArchive, openBackupFile } from './backupFile'
import { buildArchive } from './backupArchive'
import { serializeBackup, isEncrypted } from './backup'
import { toArrayBuffer } from './crypto'
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('archiveFilename', () => {
  it('names a plain archive by its export date', () => {
    expect(archiveFilename('2026-07-20T10:00:00Z', false)).toBe('bpad-backup-2026-07-20.zip')
  })

  it('marks an encrypted archive', () => {
    expect(archiveFilename('2026-07-20T10:00:00Z', true)).toBe('bpad-backup-2026-07-20-enc.zip')
  })
})

// The suite runs in plain Node, so the handful of DOM calls are stubbed
// rather than pulling in jsdom for one test.
describe('downloadArchive', () => {
  it('clicks an anchor pointing at a blob URL and revokes it', () => {
    const anchor = { click: vi.fn(), href: '', download: '' }
    vi.stubGlobal('document', { createElement: vi.fn().mockReturnValue(anchor) })
    const createObjectURL = vi.fn().mockReturnValue('blob:fake')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadArchive(new Uint8Array([1, 2, 3]), 'bpad-backup-2026-07-20.zip')

    expect(createObjectURL).toHaveBeenCalled()
    expect(anchor.href).toBe('blob:fake')
    expect(anchor.download).toBe('bpad-backup-2026-07-20.zip')
    expect(anchor.click).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('writes the archive bytes as the blob contents', async () => {
    let captured: Blob | null = null
    vi.stubGlobal('document', { createElement: () => ({ click: () => {}, href: '', download: '' }) })
    vi.stubGlobal('URL', {
      createObjectURL: (b: Blob) => {
        captured = b
        return 'blob:fake'
      },
      revokeObjectURL: () => {},
    })

    downloadArchive(new Uint8Array([1, 2, 3]), 'a.zip')

    expect(captured).not.toBeNull()
    expect(new Uint8Array(await captured!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })
})

describe('openBackupFile', () => {
  it('opens a version 2 archive', async () => {
    const archive = await buildArchive({ notes: [note], images: [], username: 'jan' })
    const picked = new File([toArrayBuffer(archive)], 'b.zip', { type: 'application/zip' })
    const handle = await openBackupFile(picked)
    expect(handle.file.username).toBe('jan')
    expect(isEncrypted(handle.file)).toBe(false)
  })

  it('opens a legacy version 1 JSON file with no entries', async () => {
    const v1 = JSON.stringify({
      ...serializeBackup([note], { username: 'jan' }),
      version: 1,
      images: undefined,
    })
    const picked = new File([v1], 'b.json', { type: 'application/json' })
    const handle = await openBackupFile(picked)
    expect(handle.file.version).toBe(1)
    expect(handle.entries).toEqual({})
  })

  it('rejects a file that is neither a zip nor JSON', async () => {
    const picked = new File(['definitely not a backup'], 'b.txt', { type: 'text/plain' })
    await expect(openBackupFile(picked)).rejects.toThrow(/couldn’t be read/i)
  })
})
