import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importNotes } from './backupImport'
import type { BackupNote } from './backup'

vi.mock('./api', () => ({ createNote: vi.fn() }))
import { createNote } from './api'

const mockCreate = vi.mocked(createNote)

function backupNote(i: number): BackupNote {
  return {
    title: `Note ${i}`,
    content: `body ${i}`,
    url: null,
    created_at: `2026-01-0${i}T00:00:00Z`,
    updated_at: `2026-01-0${i}T00:00:00Z`,
    tags: ['x'],
  }
}

beforeEach(() => {
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({} as never)
})

describe('importNotes', () => {
  it('creates every note with its title, tags and original timestamp', async () => {
    const summary = await importNotes([backupNote(1)])
    expect(summary).toEqual({ imported: 1, failed: 0, stoppedByLimit: null })
    expect(mockCreate).toHaveBeenCalledWith('body 1', ['x'], {
      title: 'Note 1',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('imports sequentially, not in parallel', async () => {
    let inFlight = 0
    let maxInFlight = 0
    mockCreate.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return {} as never
    })
    await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(maxInFlight).toBe(1)
  })

  it('reports progress after each note', async () => {
    const seen: Array<[number, number]> = []
    await importNotes([backupNote(1), backupNote(2)], (done, total) => seen.push([done, total]))
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  it('keeps going when one note fails and counts it', async () => {
    mockCreate
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Saving failed'))
      .mockResolvedValueOnce({} as never)
    const summary = await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(summary).toEqual({ imported: 2, failed: 1, stoppedByLimit: null })
    expect(mockCreate).toHaveBeenCalledTimes(3)
  })

  it('stops at the unverified-account note limit instead of failing every note', async () => {
    mockCreate
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Verify your e-mail for more than 10 notes.'))
    const summary = await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(summary).toEqual({ imported: 1, failed: 0, stoppedByLimit: 'unverified' })
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('stops at the hard per-account note limit instead of failing every note', async () => {
    mockCreate
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error('Note limit reached'))
    const summary = await importNotes([backupNote(1), backupNote(2), backupNote(3)])
    expect(summary).toEqual({ imported: 1, failed: 0, stoppedByLimit: 'hard' })
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('handles an empty import', async () => {
    await expect(importNotes([])).resolves.toEqual({
      imported: 0,
      failed: 0,
      stoppedByLimit: null,
    })
  })
})
