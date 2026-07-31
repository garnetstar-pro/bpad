import { describe, it, expect, vi, beforeEach } from 'vitest'
import { exportBackup } from './backupExport'
import { readArchive, openArchive } from './backupArchive'
import type { Note } from './types'

vi.mock('./api', () => ({ listNotes: vi.fn() }))
vi.mock('./images', () => ({ downloadImage: vi.fn() }))
import { listNotes } from './api'
import { downloadImage } from './images'

const mockList = vi.mocked(listNotes)
const mockDownload = vi.mocked(downloadImage)

const note = (over: Partial<Note> = {}): Note => ({
  id: 'server-id',
  title: 'Recipe',
  content: '# Recipe',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-02T03:04:05Z',
  tags: [],
  ...over,
})

beforeEach(() => {
  mockList.mockReset()
  mockDownload.mockReset()
  mockDownload.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/webp' })
})

describe('exportBackup', () => {
  it('packs a vault with no images', async () => {
    mockList.mockResolvedValue([note()])
    const result = await exportBackup({ username: 'jan' })
    expect(result.noteCount).toBe(1)
    expect(result.imageCount).toBe(0)
    expect(mockDownload).not.toHaveBeenCalled()
    const opened = await openArchive(readArchive(result.archive))
    expect(opened.notes[0].title).toBe('Recipe')
  })

  it('downloads every referenced image exactly once', async () => {
    mockList.mockResolvedValue([
      note({ content: '![](bpad-img:a) ![](bpad-img:b)' }),
      note({ id: 'n2', content: '![](bpad-img:a)' }),
    ])
    const result = await exportBackup({ username: 'jan' })
    expect(mockDownload).toHaveBeenCalledTimes(2)
    expect(result.imageCount).toBe(2)
    const opened = await openArchive(readArchive(result.archive))
    expect([...opened.images.keys()].sort()).toEqual(['a', 'b'])
  })

  it('downloads sequentially, not in parallel', async () => {
    let inFlight = 0
    let peak = 0
    mockDownload.mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { bytes: new Uint8Array([1]), contentType: 'image/webp' }
    })
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a) ![](bpad-img:b) ![](bpad-img:c)' })])
    await exportBackup({ username: 'jan' })
    expect(peak).toBe(1)
  })

  it('reports an image it could not download and still packs the rest', async () => {
    mockDownload.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('resolve-failed')
      return { bytes: new Uint8Array([1]), contentType: 'image/webp' }
    })
    mockList.mockResolvedValue([note({ content: '![](bpad-img:good) ![](bpad-img:bad)' })])
    const result = await exportBackup({ username: 'jan' })
    expect(result.missingImages).toEqual(['bad'])
    expect(result.imageCount).toBe(1)
    const opened = await openArchive(readArchive(result.archive))
    expect(opened.images.has('good')).toBe(true)
    expect(opened.images.has('bad')).toBe(false)
  })

  it('reports progress for images and then for packing', async () => {
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a)' })])
    const seen: string[] = []
    await exportBackup({
      username: 'jan',
      onProgress: (p) => seen.push(`${p.phase}:${p.done}/${p.total}`),
    })
    expect(seen).toEqual(['images:0/1', 'images:1/1', 'packing:1/1'])
  })

  it('produces an encrypted archive when given a passphrase', async () => {
    mockList.mockResolvedValue([note({ content: '![](bpad-img:a)' })])
    const result = await exportBackup({ username: 'jan', passphrase: 'correct horse battery' })
    const handle = readArchive(result.archive)
    expect(handle.file.encrypted).toBe(true)
    const opened = await openArchive(handle, 'correct horse battery')
    expect(opened.images.get('a')?.bytes).toEqual(new Uint8Array([1, 2, 3]))
  }, 60_000)

  it('reports an empty vault without failing', async () => {
    mockList.mockResolvedValue([])
    const result = await exportBackup({ username: 'jan' })
    expect(result.noteCount).toBe(0)
  })
})
