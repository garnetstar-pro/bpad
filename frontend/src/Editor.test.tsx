import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// No jsdom: renderToStaticMarkup gives the markup of the first render only —
// enough for the limit, which is derived from the initial draft. Editor pulls in
// api.ts, so localStorage and window have to exist (see api.test.ts).
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage
;(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
}

const { default: Editor } = await import('./Editor')
const { LanguageProvider } = await import('./i18n')

// Signed out, so getMaxImagesPerNote() returns the default of 10.
const draftWith = (count: number) =>
  Array.from({ length: count }, (_, i) => `![](bpad-img:img-${i})`).join('\n')

const render = (initialContent: string) =>
  renderToStaticMarkup(
    <LanguageProvider>
      <Editor submitLabel="File it" onSubmit={async () => {}} initialContent={initialContent} />
    </LanguageProvider>,
  )

// The button's markup: React renders `disabled` as a bare attribute.
const addImageButtonIsDisabled = (html: string) => {
  const match = html.match(/<button[^>]*class="capture-tab add-image-btn"[^>]*>/)
  if (!match) throw new Error('Add image button not found in:\n' + html)
  return match[0].includes('disabled')
}

describe('Editor image limit', () => {
  it('leaves "Add image" enabled below the limit', () => {
    expect(addImageButtonIsDisabled(render(draftWith(9)))).toBe(false)
  })

  it('disables "Add image" once the draft holds the maximum', () => {
    expect(addImageButtonIsDisabled(render(draftWith(10)))).toBe(true)
  })

  it('counts one repeated image once', () => {
    const repeated = Array.from({ length: 12 }, () => '![](bpad-img:same)').join('\n')
    expect(addImageButtonIsDisabled(render(repeated))).toBe(false)
  })
})
