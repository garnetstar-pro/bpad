import { describe, it, expect } from 'vitest'
import { welcomeNoteMarkdown } from './welcomeNote'
import { parseImageIds } from './imageRefs'

describe('welcomeNoteMarkdown', () => {
  it('starts with a top-level heading (becomes the note title)', () => {
    expect(welcomeNoteMarkdown('dev.bpad.pro')).toMatch(/^# /)
  })

  it('injects the current host into the URL-capture example', () => {
    const md = welcomeNoteMarkdown('dev.bpad.pro')
    expect(md).toContain('dev.bpad.pro/https://example.com')
  })

  it('mentions the persistent features page', () => {
    expect(welcomeNoteMarkdown('x')).toContain('What bpad can do')
  })

  it('embeds the illustration as a bpad-img reference createNote can find', () => {
    const md = welcomeNoteMarkdown('x', 'abc-123')
    expect(md).toContain('](bpad-img:abc-123)')
    // createNote derives image_ids from the content, so this is what keeps the
    // uploaded blob alive.
    expect(parseImageIds(md)).toEqual(['abc-123'])
  })

  it('omits the picture section entirely when the upload failed', () => {
    const md = welcomeNoteMarkdown('x')
    expect(parseImageIds(md)).toEqual([])
    expect(md).not.toContain('What the server sees')
    expect(md).not.toContain('{image}')
  })

  it('leaves no gap where the picture section would have been', () => {
    expect(welcomeNoteMarkdown('x')).not.toMatch(/\n{3,}/)
  })
})
