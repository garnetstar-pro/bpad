import { describe, it, expect } from 'vitest'
import { remainingNotes, verifyBannerMessage, UNVERIFIED_NOTE_LIMIT } from './verifyStatus'

describe('remainingNotes', () => {
  it('counts down toward the limit', () => {
    expect(remainingNotes(0)).toBe(UNVERIFIED_NOTE_LIMIT)
    expect(remainingNotes(7)).toBe(3)
    expect(remainingNotes(10)).toBe(0)
  })

  it('never goes negative past the limit', () => {
    expect(remainingNotes(15)).toBe(0)
  })

  it('treats unknown count as zero used', () => {
    expect(remainingNotes(null)).toBe(UNVERIFIED_NOTE_LIMIT)
  })
})

describe('verifyBannerMessage', () => {
  it('shows the remaining count before the limit', () => {
    expect(verifyBannerMessage(7)).toContain('zbývá 3 z 10')
  })

  it('switches to a limit-reached message at zero remaining', () => {
    const msg = verifyBannerMessage(10)
    expect(msg).toContain('limitu 10')
    expect(msg).not.toContain('zbývá')
  })
})
