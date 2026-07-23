import { describe, it, expect } from 'vitest'
import { shouldStartExpanded } from './composer'

describe('shouldStartExpanded', () => {
  it('starts expanded when the account is known to have no notes', () => {
    expect(shouldStartExpanded(0)).toBe(true)
  })

  it('starts collapsed when the account has notes', () => {
    expect(shouldStartExpanded(5)).toBe(false)
  })

  it('starts collapsed while the note count is still unknown', () => {
    // null = not yet loaded; don't flash the editor open then snap it shut.
    expect(shouldStartExpanded(null)).toBe(false)
  })
})
