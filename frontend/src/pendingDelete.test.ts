import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// No jsdom: the module only needs somewhere to dispatch its change event.
const listeners: (() => void)[] = []
;(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => {
    listeners.forEach((l) => l())
    return true
  },
}
;(globalThis as unknown as { Event: unknown }).Event = class {
  type: string
  constructor(type: string) {
    this.type = type
  }
}

const {
  schedulePendingDelete,
  undoPendingDelete,
  getPendingDelete,
  isPendingDelete,
  resetPendingDelete,
  UNDO_WINDOW_MS,
} = await import('./pendingDelete')

beforeEach(() => {
  vi.useFakeTimers()
  resetPendingDelete()
  listeners.length = 0
})
afterEach(() => vi.useRealTimers())

describe('schedulePendingDelete', () => {
  it('does not call the API before the window closes', async () => {
    const commit = vi.fn().mockResolvedValue(undefined)
    schedulePendingDelete('n1', 'Note one', commit)

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1)
    expect(commit).not.toHaveBeenCalled()
    expect(getPendingDelete()).toEqual({ id: 'n1', title: 'Note one' })
  })

  it('calls the API once the window closes', async () => {
    const commit = vi.fn().mockResolvedValue(undefined)
    schedulePendingDelete('n1', 'Note one', commit)

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(commit).toHaveBeenCalledExactlyOnceWith('n1')
    expect(getPendingDelete()).toBeNull()
  })

  it('hides the note while it is pending', () => {
    schedulePendingDelete('n1', 'Note one', vi.fn())
    expect(isPendingDelete('n1')).toBe(true)
    expect(isPendingDelete('n2')).toBe(false)
  })

  it('announces the change so the list and toast can react', () => {
    const seen = vi.fn()
    listeners.push(seen)
    schedulePendingDelete('n1', 'Note one', vi.fn())
    expect(seen).toHaveBeenCalled()
  })

  it('commits the previous note when a second delete arrives', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    schedulePendingDelete('n1', 'One', first)
    schedulePendingDelete('n2', 'Two', second)

    expect(first).toHaveBeenCalledExactlyOnceWith('n1')
    expect(getPendingDelete()).toEqual({ id: 'n2', title: 'Two' })
    expect(second).not.toHaveBeenCalled()
  })

  it('survives a failing commit without throwing', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('offline'))
    schedulePendingDelete('n1', 'One', commit)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS)
    expect(getPendingDelete()).toBeNull()
  })
})

describe('undoPendingDelete', () => {
  it('stops the API call from ever happening', async () => {
    const commit = vi.fn().mockResolvedValue(undefined)
    schedulePendingDelete('n1', 'Note one', commit)
    undoPendingDelete()

    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2)
    expect(commit).not.toHaveBeenCalled()
    expect(getPendingDelete()).toBeNull()
    expect(isPendingDelete('n1')).toBe(false)
  })

  it('is harmless when nothing is pending', () => {
    expect(() => undoPendingDelete()).not.toThrow()
  })
})
