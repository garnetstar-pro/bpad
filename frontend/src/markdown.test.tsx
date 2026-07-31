import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { bpadUrlTransform, markdownComponents, markdownPlugins, ZoomableImage } from './markdown'
import { LanguageProvider } from './i18n'

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

describe('ZoomableImage', () => {
  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ZoomableImage src="https://example.com/a.webp" alt="a screenshot" />
    </LanguageProvider>,
  )

  it('wraps the image in a button labelled with the image alt text', () => {
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="view image larger: a screenshot"')
    expect(html).toContain('class="note-image-btn"')
  })

  it('keeps the image src, alt and note-image class', () => {
    expect(html).toContain('src="https://example.com/a.webp"')
    expect(html).toContain('alt="a screenshot"')
    expect(html).toContain('class="note-image"')
  })

  it('renders closed — no overlay until clicked', () => {
    expect(html).not.toContain('lightbox-overlay')
  })
})

describe('ZoomableImage with no alt text', () => {
  it('falls back to the generic zoom label', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <ZoomableImage src="https://example.com/a.webp" alt="" />
      </LanguageProvider>,
    )
    expect(html).toContain('aria-label="view image larger"')
    expect(html).not.toContain('view image larger:')
  })
})

describe('plain image title is preserved', () => {
  // The fallback img branch used to spread ...props (carrying `title` from
  // markdown's ![alt](url "title") syntax) straight onto a bare <img>. Routing
  // it through ZoomableImage must not silently drop that attribute.
  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        components={markdownComponents}
        urlTransform={bpadUrlTransform}
      >
        {'![shot](https://example.com/a.png "Login screen")'}
      </ReactMarkdown>
    </LanguageProvider>,
  )

  it('renders the title attribute on the img', () => {
    expect(html).toContain('title="Login screen"')
  })
})

describe('bpad-img placeholders are not clickable', () => {
  // useEffect does not run under renderToStaticMarkup, so BpadImage stays in
  // its initial "loading" state here — exactly the state we want to assert is
  // inert. There is nothing to enlarge until the SAS URL resolves.
  const html = renderToStaticMarkup(
    <LanguageProvider>
      <ReactMarkdown
        remarkPlugins={markdownPlugins}
        components={markdownComponents}
        urlTransform={bpadUrlTransform}
      >
        {'![shot](bpad-img:abc-123)'}
      </ReactMarkdown>
    </LanguageProvider>,
  )

  it('renders the loading placeholder without a button', () => {
    expect(html).toContain('note-image-loading')
    expect(html).not.toContain('<button')
  })
})
