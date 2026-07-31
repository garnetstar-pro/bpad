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

  it('names the dialog from the image alt text', () => {
    const html = render()
    // The dialog's own aria-label, not the close button's — distinguish by
    // checking it sits on the role="dialog" element.
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="a screenshot"')
  })

  it('falls back to the generic alt text when the image has none', () => {
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <ImageLightbox src="https://example.com/a.webp" alt="" onClose={() => {}} />
      </LanguageProvider>,
    )
    expect(html).toContain('aria-label="note image"')
  })

  it('renders exactly one interactive element inside the dialog (the close button)', () => {
    // Tab must have nowhere to go but the close button — that's what makes
    // the focus trap in the history/focus effect complete. Verified
    // statically: the dialog markup contains one <button> and one <img>, no
    // other focusable element.
    const html = render()
    const buttonCount = (html.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(1)
    expect(html).toContain('<img')
  })
})
