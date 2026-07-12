import { describe, it, expect } from 'vitest'
import { welcomeNoteMarkdown } from './welcomeNote'

describe('welcomeNoteMarkdown', () => {
  it('starts with a top-level heading (becomes the note title)', () => {
    expect(welcomeNoteMarkdown('dev.bpad.pro')).toMatch(/^# /)
  })

  it('injects the current host into the URL-capture example', () => {
    const md = welcomeNoteMarkdown('dev.bpad.pro')
    expect(md).toContain('dev.bpad.pro/https://example.com')
  })

  it('mentions the persistent features page', () => {
    expect(welcomeNoteMarkdown('x')).toContain('Co bpad umí')
  })
})
