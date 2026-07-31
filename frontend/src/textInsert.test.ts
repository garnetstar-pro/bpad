import { describe, it, expect } from 'vitest'
import { insertAt } from './textInsert'

describe('insertAt', () => {
  it('inserts at a collapsed caret and reports the caret after the snippet', () => {
    const { text, caret } = insertAt('hello world', 5, 5, ' there')
    expect(text).toBe('hello there world')
    expect(caret).toBe(11)
  })

  it('replaces a selection', () => {
    const { text, caret } = insertAt('hello world', 6, 11, 'there')
    expect(text).toBe('hello there')
    expect(caret).toBe(11)
  })

  it('appends at the end of an empty draft', () => {
    const { text, caret } = insertAt('', 0, 0, '![](bpad-img:abc)')
    expect(text).toBe('![](bpad-img:abc)')
    expect(caret).toBe(17)
  })

  it('clamps bounds that went stale while the upload was in flight', () => {
    // The draft shrank under the caller: 40 is past the end of the text.
    const { text, caret } = insertAt('short', 40, 40, 'X')
    expect(text).toBe('shortX')
    expect(caret).toBe(6)
  })

  it('never folds the caret backwards when end precedes start', () => {
    const { text, caret } = insertAt('abcdef', 4, 2, 'X')
    expect(text).toBe('abcdXef')
    expect(caret).toBe(5)
  })
})
