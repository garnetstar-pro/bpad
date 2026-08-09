import { describe, it, expect } from 'vitest'
import { buildSharedNote } from './shareTarget'

describe('buildSharedNote', () => {
  it('handles the Chrome shape (title + url)', () => {
    expect(buildSharedNote({ title: 'Example Domain', url: 'https://example.com' })).toEqual({
      content: '# Example Domain\n\nhttps://example.com',
      url: 'https://example.com',
    })
  })

  it('mines the url out of text when the url field is empty', () => {
    // Reddit / X / YouTube all share this way.
    expect(buildSharedNote({ text: 'Check this out https://example.com/post' })).toEqual({
      content: 'https://example.com/post\n\nCheck this out',
      url: 'https://example.com/post',
    })
  })

  it('does not repeat a url that appears in both fields', () => {
    const note = buildSharedNote({
      title: 'Post',
      text: 'https://example.com/post',
      url: 'https://example.com/post',
    })
    expect(note!.content).toBe('# Post\n\nhttps://example.com/post')
  })

  it('keeps a plain text selection with no url', () => {
    expect(buildSharedNote({ text: 'a paragraph worth keeping' })).toEqual({
      content: 'a paragraph worth keeping',
      url: null,
    })
  })

  it('keeps the selected text alongside the link', () => {
    const note = buildSharedNote({
      title: 'Article',
      text: 'the quoted bit',
      url: 'https://example.com/a',
    })
    expect(note!.content).toBe('# Article\n\nhttps://example.com/a\n\nthe quoted bit')
  })

  it('does not duplicate a title that equals the text', () => {
    const note = buildSharedNote({ title: 'Same', text: 'Same', url: 'https://example.com' })
    expect(note!.content).toBe('# Same\n\nhttps://example.com')
  })

  it('does not use a bare url as the heading', () => {
    const note = buildSharedNote({ title: 'https://example.com', url: 'https://example.com' })
    expect(note!.content).toBe('https://example.com')
  })

  it('strips sentence punctuation off a mined url', () => {
    const note = buildSharedNote({ text: 'see https://example.com/a, it is good' })
    expect(note!.url).toBe('https://example.com/a')
  })

  it('ignores a url field that is not a url', () => {
    // Some apps put the app name or a content:// uri in `url`.
    const note = buildSharedNote({ text: 'note body', url: 'content://media/1' })
    expect(note).toEqual({ content: 'note body', url: null })
  })

  it('returns null for an empty share', () => {
    expect(buildSharedNote({})).toBeNull()
    expect(buildSharedNote({ title: '  ', text: '', url: null })).toBeNull()
  })

  it('accepts a bare url with nothing else', () => {
    expect(buildSharedNote({ url: 'https://example.com' })).toEqual({
      content: 'https://example.com',
      url: 'https://example.com',
    })
  })
})
