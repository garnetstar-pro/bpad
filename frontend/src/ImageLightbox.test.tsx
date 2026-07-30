import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ImageLightbox from './ImageLightbox'
import { LanguageProvider } from './i18n'

// No jsdom: renderToStaticMarkup gives us the markup only. useEffect does not
// run here, so Esc / history / scroll-lock are verified manually (see the spec).
const render = () =>
  renderToStaticMarkup(
    <LanguageProvider>
      <ImageLightbox src="https://example.com/a.webp" alt="a screenshot" onClose={() => {}} />
    </LanguageProvider>,
  )

describe('ImageLightbox', () => {
  it('renders a modal dialog overlay', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('class="lightbox-overlay"')
  })

  it('renders the image with the given src and alt', () => {
    const html = render()
    expect(html).toContain('src="https://example.com/a.webp"')
    expect(html).toContain('alt="a screenshot"')
  })

  it('renders a labelled close button', () => {
    const html = render()
    expect(html).toContain('aria-label="close image"')
  })
})
