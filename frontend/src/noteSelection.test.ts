import { describe, it, expect } from 'vitest'
import { shouldAutoOpenTop } from './noteSelection'

const base = {
  wide: true,
  loading: false,
  refetching: false,
  topId: 'a',
  activeId: 'a' as string | null | undefined,
  noteIds: ['a', 'b'],
}

describe('shouldAutoOpenTop', () => {
  it('opens the top note when nothing is selected (root URL)', () => {
    expect(shouldAutoOpenTop({ ...base, activeId: null })).toBe(true)
  })

  it('opens the top note when the selected id no longer exists', () => {
    expect(shouldAutoOpenTop({ ...base, activeId: 'gone' })).toBe(true)
  })

  it('leaves a valid selection alone', () => {
    expect(shouldAutoOpenTop({ ...base, activeId: 'b' })).toBe(false)
  })

  it('does not redirect while a refetch is in flight', () => {
    // A just-created note is not yet in noteIds; without this guard the effect
    // would clobber the composer's navigation back to the old top note.
    expect(
      shouldAutoOpenTop({ ...base, refetching: true, activeId: 'fresh', topId: 'b' }),
    ).toBe(false)
  })

  it('does nothing on a narrow (single-pane) layout', () => {
    expect(shouldAutoOpenTop({ ...base, wide: false, activeId: null })).toBe(false)
  })

  it('does nothing while loading or with no notes', () => {
    expect(shouldAutoOpenTop({ ...base, loading: true, activeId: null })).toBe(false)
    expect(shouldAutoOpenTop({ ...base, topId: undefined, activeId: null })).toBe(false)
  })
})
