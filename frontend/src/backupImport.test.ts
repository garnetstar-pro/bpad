import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importBackup } from './backupImport'
import { UploadRateLimited } from './images'
import type { BackupNote } from './backup'
import type { ArchiveImage } from './backupArchive'

vi.mock('./api', () => ({ createNote: vi.fn() }))
vi.mock('./images', async () => {
  const actual = await vi.importActual<typeof import('./images')>('./images')
  return { uploadImage: vi.fn(), UploadRateLimited: actual.UploadRateLimited }
})
import { createNote } from './api'
import { uploadImage } from './images'

const mockCreate = vi.mocked(createNote)
const mockUpload = vi.mocked(uploadImage)

function backupNote(i: number, content = `body ${i}`): BackupNote {
  return {
    title: `Note ${i}`,
    content,
    url: null,
    created_at: `2026-01-0${i}T00:00:00Z`,
    updated_at: `2026-01-0${i}T00:00:00Z`,
    tags: ['x'],
  }
}

const picture = (id: string): ArchiveImage => ({
  id,
  content_type: 'image/webp',
  bytes: new Uint8Array([1, 2, 3]),
})

beforeEach(() => {
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({} as never)
  mockUpload.mockReset()
  mockUpload.mockImplementation(async () => `new-${mockUpload.mock.calls.length}`)
})

describe('importBackup', () => {
  it('creates every note with its title, tags and original timestamp', async () => {
    const summary = await importBackup([backupNote(1)], new Map())
    expect(summary).toEqual({
      imported: 1,
      failed: 0,
      imagesUploaded: 0,
      imagesFailed: 0,
      stoppedByLimit: null,
    })
    expect(mockCreate).toHaveBeenCalledWith('body 1', ['x'], {
      title: 'Note 1',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('uploads images before creating any note', async () => {
    const order: string[] = []
    mockUpload.mockImplementation(async () => {
      order.push('upload')
      return 'new-id'
    })
    mockCreate.mockImplementation(async () => {
      order.push('create')
      return {} as never
    })
    await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(order).toEqual(['upload', 'create'])
  })

  it('rewrites references to the new ids', async () => {
    mockUpload.mockResolvedValue('fresh-id')
    await importBackup(
      [backupNote(1, 'a ![](bpad-img:old) b')],
      new Map([['old', picture('old')]]),
    )
    expect(mockCreate).toHaveBeenCalledWith('a ![](bpad-img:fresh-id) b', ['x'], expect.anything())
  })

  it('uploads an image referenced by two notes only once', async () => {
    await importBackup(
      [backupNote(1, '![](bpad-img:shared)'), backupNote(2, '![](bpad-img:shared)')],
      new Map([['shared', picture('shared')]]),
    )
    expect(mockUpload).toHaveBeenCalledTimes(1)
  })

  it('ignores an image the notes do not reference', async () => {
    await importBackup([backupNote(1)], new Map([['orphan', picture('orphan')]]))
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('keeps the original reference when an upload fails, and still imports the note', async () => {
    mockUpload.mockRejectedValue(new Error('upload-failed'))
    const summary = await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(summary.imagesFailed).toBe(1)
    expect(summary.imported).toBe(1)
    expect(mockCreate).toHaveBeenCalledWith('![](bpad-img:old)', ['x'], expect.anything())
  })

  it('stops the whole import when the image rate limit is hit', async () => {
    mockUpload.mockRejectedValue(new UploadRateLimited())
    const summary = await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
    )
    expect(summary.stoppedByLimit).toBe('images')
    expect(summary.imported).toBe(0)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('imports sequentially, not in parallel', async () => {
    let inFlight = 0
    let peak = 0
    mockCreate.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return {} as never
    })
    await importBackup([backupNote(1), backupNote(2), backupNote(3)], new Map())
    expect(peak).toBe(1)
  })

  it('counts a failed note and carries on', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))
    const summary = await importBackup([backupNote(1), backupNote(2)], new Map())
    expect(summary.imported).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('stops on the unverified-account note limit', async () => {
    mockCreate.mockRejectedValue(new Error('Please verify your e-mail to add more notes'))
    const summary = await importBackup([backupNote(1), backupNote(2)], new Map())
    expect(summary.stoppedByLimit).toBe('unverified')
    expect(summary.imported).toBe(0)
  })

  it('stops on the hard note limit', async () => {
    mockCreate.mockRejectedValue(new Error('Note limit reached'))
    const summary = await importBackup([backupNote(1)], new Map())
    expect(summary.stoppedByLimit).toBe('hard')
  })

  it('reports progress for both phases', async () => {
    const seen: string[] = []
    await importBackup(
      [backupNote(1, '![](bpad-img:old)')],
      new Map([['old', picture('old')]]),
      (p) => seen.push(`${p.phase}:${p.done}/${p.total}`),
    )
    expect(seen).toEqual(['images:0/1', 'images:1/1', 'notes:0/1', 'notes:1/1'])
  })
})
