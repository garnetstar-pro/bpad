import { describe, it, expect } from 'vitest'
import { slugify, renderNoteMarkdown, buildMarkdownFiles } from './backupMarkdown'
import type { BackupNote } from './backup'

const bn = (over: Partial<BackupNote> = {}): BackupNote => ({
  title: 'Groceries',
  content: 'milk',
  url: null,
  created_at: '2026-01-02T03:04:05Z',
  updated_at: '2026-01-03T03:04:05Z',
  tags: ['home'],
  ...over,
})

describe('slugify', () => {
  it('strips diacritics and lowercases', () => {
    expect(slugify('Příliš žluťoučký kůň')).toBe('prilis-zlutoucky-kun')
  })

  it('collapses punctuation and spaces into single dashes', () => {
    expect(slugify('Shopping: milk, bread!')).toBe('shopping-milk-bread')
  })

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --- hello ---  ')).toBe('hello')
  })

  it('caps the length and does not end in a dash', () => {
    const s = slugify('a'.repeat(30) + ' ' + 'b'.repeat(30))
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('-')).toBe(false)
  })

  it('falls back for a title with nothing usable in it', () => {
    expect(slugify('★★★')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
  })
})

describe('renderNoteMarkdown', () => {
  it('writes front matter and the body', () => {
    const out = renderNoteMarkdown(bn(), new Map())
    expect(out).toBe(
      '---\ntitle: "Groceries"\ncreated: 2026-01-02T03:04:05Z\n' +
        'updated: 2026-01-03T03:04:05Z\ntags: ["home"]\n---\n\nmilk\n',
    )
  })

  it('escapes quotes and backslashes in the title', () => {
    const out = renderNoteMarkdown(bn({ title: 'He said "hi" \\ bye' }), new Map())
    expect(out).toContain('title: "He said \\"hi\\" \\\\ bye"')
  })

  it('writes an empty tag list', () => {
    expect(renderNoteMarkdown(bn({ tags: [] }), new Map())).toContain('tags: []')
  })

  it('rewrites image references to relative paths', () => {
    const paths = new Map([['abc', '../images/abc.webp']])
    const out = renderNoteMarkdown(bn({ content: 'see ![pic](bpad-img:abc)' }), paths)
    expect(out).toContain('see ![pic](../images/abc.webp)')
  })

  it('leaves a reference with no path alone', () => {
    const out = renderNoteMarkdown(bn({ content: '![](bpad-img:missing)' }), new Map())
    expect(out).toContain('![](bpad-img:missing)')
  })
})

describe('buildMarkdownFiles', () => {
  it('names files by creation date and slug', () => {
    const files = buildMarkdownFiles([bn()], new Map())
    expect(Object.keys(files)).toEqual(['2026-01-02-groceries.md'])
  })

  it('disambiguates colliding names', () => {
    const files = buildMarkdownFiles([bn(), bn(), bn()], new Map())
    expect(Object.keys(files)).toEqual([
      '2026-01-02-groceries.md',
      '2026-01-02-groceries-2.md',
      '2026-01-02-groceries-3.md',
    ])
  })

  it('handles an empty vault', () => {
    expect(buildMarkdownFiles([], new Map())).toEqual({})
  })
})
