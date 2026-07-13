import { describe, it, expect } from 'vitest'
import { normalizeTag, normalizeTags, collectTags, filterByTags, distinctTagCount, FREE_TAG_LIMIT } from './tags'
import type { Note } from './types'

const note = (id: string, tags: string[]): Note => ({
  id, title: id, content: '', url: null, created_at: '2026-01-01T00:00:00', updated_at: '2026-01-01T00:00:00', tags,
})

describe('normalizeTag', () => {
  it('lowercases, strips #, trims, removes inner whitespace', () => {
    expect(normalizeTag('  #Work ')).toBe('work')
    expect(normalizeTag('#My Tag')).toBe('mytag')
    expect(normalizeTag('   ')).toBe('')
  })
})

describe('normalizeTags', () => {
  it('drops empties and dedupes preserving first-seen order', () => {
    expect(normalizeTags(['#b', 'B', '', 'a'])).toEqual(['b', 'a'])
  })
})

describe('collectTags', () => {
  it('returns the sorted union across notes', () => {
    expect(collectTags([note('1', ['b', 'a']), note('2', ['a', 'c'])])).toEqual(['a', 'b', 'c'])
  })
})

describe('filterByTags', () => {
  const notes = [note('1', ['work', '2026']), note('2', ['work']), note('3', [])]
  it('AND across selected tags', () => {
    expect(filterByTags(notes, ['work', '2026'], false).map((n) => n.id)).toEqual(['1'])
    expect(filterByTags(notes, ['work'], false).map((n) => n.id)).toEqual(['1', '2'])
  })
  it('untaggedOnly returns only tag-less notes', () => {
    expect(filterByTags(notes, [], true).map((n) => n.id)).toEqual(['3'])
  })
  it('empty selection returns all notes', () => {
    expect(filterByTags(notes, [], false)).toHaveLength(3)
  })
})

describe('FREE_TAG_LIMIT', () => {
  it('is 12 (distinct tags per account)', () => expect(FREE_TAG_LIMIT).toBe(12))
})

describe('distinctTagCount', () => {
  it('counts the union of known and note tags', () => {
    expect(distinctTagCount(['a', 'b'], ['b', 'c'])).toBe(3)
    expect(distinctTagCount([], ['x'])).toBe(1)
    expect(distinctTagCount(['a', 'b'], [])).toBe(2)
  })
})
