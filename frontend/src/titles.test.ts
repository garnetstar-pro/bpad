import { describe, it, expect } from 'vitest'
import { extractTitle, resolveTitle } from './titles'

describe('extractTitle', () => {
  it('takes the first H1 heading', () => {
    expect(extractTitle('# My Note\nbody')).toBe('My Note')
  })

  it('takes a deeper first heading', () => {
    expect(extractTitle('## Subheading\nbody')).toBe('Subheading')
  })

  it('finds a heading after body text', () => {
    expect(extractTitle('intro\n\n# Real Heading\nmore')).toBe('Real Heading')
  })

  it('falls back to the first non-empty line', () => {
    expect(extractTitle('\n\nplain text\nsecond')).toBe('plain text')
  })

  it('returns a placeholder for empty input', () => {
    expect(extractTitle('   \n\t\n')).toBe('(untitled)')
  })

  it('strips inline formatting', () => {
    expect(extractTitle('# My **Awesome** Note')).toBe('My Awesome Note')
    expect(extractTitle('*sdff*')).toBe('sdff')
    expect(extractTitle('[label](url)')).toBe('label')
    expect(extractTitle('`code`')).toBe('code')
  })

  it('strips a trailing closing hash sequence', () => {
    expect(extractTitle('## Centered ##\nbody')).toBe('Centered')
  })

  it('leaves invalid link syntax alone', () => {
    expect(extractTitle('(sdfs)[ss]')).toBe('(sdfs)[ss]')
  })
})

describe('resolveTitle', () => {
  it('keeps an explicit title', () => {
    expect(resolveTitle('Custom', '# Heading\nbody')).toBe('Custom')
  })

  it('trims an explicit title', () => {
    expect(resolveTitle('  Spaced  ', '# H')).toBe('Spaced')
  })

  it('falls back to derived when title is empty', () => {
    expect(resolveTitle('   ', '# Derived')).toBe('Derived')
    expect(resolveTitle(undefined, '# Derived')).toBe('Derived')
  })
})
