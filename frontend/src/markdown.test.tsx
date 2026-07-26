import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { bpadUrlTransform, markdownPlugins } from './markdown'

const render = (source: string) =>
  renderToStaticMarkup(<ReactMarkdown remarkPlugins={markdownPlugins}>{source}</ReactMarkdown>)

describe('bpadUrlTransform', () => {
  it('preserves bpad-img references untouched', () => {
    expect(bpadUrlTransform('bpad-img:abc-123')).toBe('bpad-img:abc-123')
  })
  it('passes http(s) urls through', () => {
    expect(bpadUrlTransform('https://example.com/x.png')).toBe('https://example.com/x.png')
  })
  it('sanitizes disallowed protocols like the default (javascript:)', () => {
    expect(bpadUrlTransform('javascript:alert(1)')).toBe('')
  })
})

describe('markdownPlugins line breaks', () => {
  it('renders a blank line as two paragraphs', () => {
    expect(render('first\n\nsecond')).toBe('<p>first</p>\n<p>second</p>')
  })

  it('renders a single newline as a hard break, not a joined line', () => {
    expect(render('first\nsecond')).toBe('<p>first<br/>\nsecond</p>')
  })

  it('still renders gfm tables', () => {
    expect(render('| a |\n| - |\n| b |')).toContain('<table>')
  })
})
