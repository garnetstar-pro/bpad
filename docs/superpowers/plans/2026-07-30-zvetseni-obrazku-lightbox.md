# Image Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking or tapping an image inside a note opens it full-screen, as large as it fits.

**Architecture:** A standalone `ImageLightbox` overlay component (knows only `src`/`alt`/`onClose`) plus a small `ZoomableImage` wrapper in `markdown.tsx` that holds the open/closed state and wraps the image in a button. Both branches of `markdownComponents.img` — resolved `bpad-img:` refs and plain `http(s)` images — go through the wrapper, so the note detail and the editor preview get identical behaviour from one place. No backend, API, crypto or blob changes: the lightbox reuses the already-resolved `src`.

**Tech Stack:** React 19 + TypeScript, react-markdown v10, plain CSS in `frontend/src/App.css`, vitest without jsdom (tests render through `renderToStaticMarkup` from `react-dom/server`).

**Spec:** `docs/superpowers/specs/2026-07-30-zvetseni-obrazku-lightbox-design.md`

## Global Constraints

- **All work is in `frontend/`.** Run every command from `frontend/` (`cd frontend`). Nothing in `api/` changes.
- **No user-facing string may be hardcoded in a component.** Every label goes through `t()` from `./i18n`; the dictionary is `frontend/src/i18n/en.ts`.
- **Code comments and logs are English.** (The design docs under `docs/` are Czech; code is not.)
- **There is no jsdom.** Tests run in plain Node. Never use `@testing-library/react`, `render()`, `document`, or `window` in a test without stubbing the global yourself. Component tests use `renderToStaticMarkup` — see `frontend/src/markdown.test.tsx` for the established pattern. `useEffect` does **not** run under `renderToStaticMarkup`.
- **Do not add dependencies.** No lightbox library, no jsdom, no testing-library.
- **Do not add `viewport-fit=cover`** to `frontend/index.html`. It would change layout across the whole app. `env(safe-area-inset-*)` therefore resolves to `0` today; the CSS uses `max(20px, env(...))` so the 20px base applies.
- **CSS goes in `frontend/src/App.css`**, next to the existing `.note-image` rules (~line 1411). Use the existing custom properties (`--ink`, `--ink-dim`, `--hairline`, `--text-md`) rather than literal colours.
- **Verification gate:** `npm run test`, `npm run lint`, and `npm run build` must all pass before the final commit of each task that changes code.

---

### Task 1: `ImageLightbox` component

The full-screen overlay on its own. It takes an already-resolved image URL, so it has no knowledge of `bpad-img:` refs, SAS URLs, or notes.

**Files:**
- Create: `frontend/src/ImageLightbox.tsx`
- Create: `frontend/src/ImageLightbox.test.tsx`
- Modify: `frontend/src/i18n/en.ts` (add `images.close`)
- Modify: `frontend/src/App.css` (add `.lightbox-*` rules)

**Interfaces:**
- Consumes: `useTranslation` from `./i18n` (existing).
- Produces: `export default function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }): JSX.Element` — consumed by Task 2.
- Produces i18n key `images.close`.

- [ ] **Step 1: Add the i18n key**

In `frontend/src/i18n/en.ts`, extend the existing `images` section (it currently holds `loading`, `failed`, `alt`) so it reads:

```ts
  images: {
    loading: 'loading image…',
    failed: 'image unavailable',
    alt: 'note image',
    zoom: 'view image larger',
    close: 'close image',
  },
```

`images.zoom` is used in Task 2; adding both now keeps the dictionary edit to one place.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/ImageLightbox.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ImageLightbox from './ImageLightbox'

// No jsdom: renderToStaticMarkup gives us the markup only. useEffect does not
// run here, so Esc / history / scroll-lock are verified manually (see the spec).
const render = () =>
  renderToStaticMarkup(
    <ImageLightbox src="https://example.com/a.webp" alt="a screenshot" onClose={() => {}} />,
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/ImageLightbox.test.tsx`
Expected: FAIL — cannot resolve `./ImageLightbox`.

- [ ] **Step 4: Write the component**

Create `frontend/src/ImageLightbox.tsx`:

```tsx
import { useEffect } from 'react'
import { useTranslation } from './i18n'

// Full-screen overlay showing one image as large as it fits. It knows nothing
// about bpad-img: refs — the caller passes an already-resolved src, so opening
// the lightbox costs no request and no fresh SAS URL.
//
// Every way out (backdrop, image, close button, Esc, the phone's Back button)
// funnels into onClose. onClose must be referentially stable — the effects below
// depend on it, and a new function each render would push a history entry each
// render. Callers use useCallback.
export default function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A history entry so the phone's Back button closes the lightbox instead of
  // leaving the note. The URL does not change, so react-router does not
  // navigate; spreading the existing state preserves the router's own keys.
  //
  // The cleanup pops our entry only if it is still there: when Back did the
  // closing it is already gone, and calling back() again would jump two steps.
  useEffect(() => {
    window.history.pushState({ ...window.history.state, bpadLightbox: true }, '')
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.bpadLightbox) window.history.back()
    }
  }, [onClose])

  // Keep the page behind from scrolling. This covers mobile, where the body
  // scrolls; on desktop an inner column scrolls instead, which is deliberately
  // left alone (it happens out of sight behind the overlay).
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // A <span>, not a <div>, on purpose: the caller renders this next to an image
  // that markdown has placed inside a <p>, and a <div> there is invalid nesting.
  // A span is phrasing content, and CSS makes it the flex overlay.
  return (
    <span className="lightbox-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <button
        className="lightbox-close"
        onClick={onClose}
        aria-label={t('images.close')}
        type="button"
      >
        ✕
      </button>
      <img className="lightbox-image" src={src} alt={alt} />
    </span>
  )
}
```

Note there is no `stopPropagation` on the image: there is nothing to operate inside the lightbox, so a tap anywhere closes it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/ImageLightbox.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 6: Add the CSS**

In `frontend/src/App.css`, immediately after the `.note-image-loading, .note-image-failed` block (~line 1424), add:

```css
/* Full-screen image view. Rendered inline in the note tree, not through a
   portal: position:fixed resolves against the viewport only because no
   ancestor creates a containing block (no transform/filter/contain on the
   layout panes). If that ever changes, the lightbox will be trapped inside
   the column — this is the first place to look. (A portal would sidestep that,
   but react-dom/server cannot render portals and the test suite has no jsdom.)
   The element is a <span>; display:flex is what makes it the overlay. */
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(6, 11, 22, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  /* env() is 0 today (index.html has no viewport-fit=cover, so the browser
     already insets the viewport); max() keeps the 20px base and stays correct
     if that ever changes. */
  padding: max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
    max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  cursor: zoom-out;
}
.lightbox-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
}
.lightbox-close {
  position: absolute;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  background: none;
  border: none;
  color: var(--ink);
  font-size: 22px;
  line-height: 1;
  padding: 10px;
  cursor: pointer;
  opacity: 0.75;
}
.lightbox-close:hover { opacity: 1; }
```

`z-index: 60` sits above the existing `.modal-overlay` (`z-index: 50`).

- [ ] **Step 7: Verify the whole suite, lint and build**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: all pass. (The build also runs `tsc -b`, which is what catches a wrong prop type.)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/ImageLightbox.tsx frontend/src/ImageLightbox.test.tsx \
        frontend/src/i18n/en.ts frontend/src/App.css
git commit -m "feat(web): full-screen image lightbox component"
```

---

### Task 2: Make images in notes open the lightbox

Wire the overlay into the shared markdown renderer, so both the note detail and the editor preview get it.

**Files:**
- Modify: `frontend/src/markdown.tsx` (add `ZoomableImage`, route both `img` branches through it)
- Modify: `frontend/src/markdown.test.tsx` (add a `ZoomableImage` describe block)
- Modify: `frontend/src/App.css` (add `.note-image-btn`, `cursor: zoom-in` on `.note-image`)

**Interfaces:**
- Consumes: `ImageLightbox` (default export from `./ImageLightbox`, Task 1); the i18n key `images.zoom` (added in Task 1).
- Consumes: existing `BpadImage`, `markdownComponents`, `bpadUrlTransform` in `markdown.tsx`.
- Produces: `export function ZoomableImage({ src, alt }: { src: string; alt: string }): JSX.Element` — exported so the test can render it directly; no other module imports it.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/markdown.test.tsx`, replace the existing import line from `./markdown` (currently `import { bpadUrlTransform, markdownPlugins } from './markdown'`) with:

```tsx
import { bpadUrlTransform, markdownComponents, markdownPlugins, ZoomableImage } from './markdown'
```

Then add these two describe blocks at the end of the file:

```tsx
describe('ZoomableImage', () => {
  const html = renderToStaticMarkup(
    <ZoomableImage src="https://example.com/a.webp" alt="a screenshot" />,
  )

  it('wraps the image in a labelled button', () => {
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="view image larger"')
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

describe('bpad-img placeholders are not clickable', () => {
  // useEffect does not run under renderToStaticMarkup, so BpadImage stays in
  // its initial "loading" state here — exactly the state we want to assert is
  // inert. There is nothing to enlarge until the SAS URL resolves.
  const html = renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={markdownPlugins}
      components={markdownComponents}
      urlTransform={bpadUrlTransform}
    >
      {'![shot](bpad-img:abc-123)'}
    </ReactMarkdown>,
  )

  it('renders the loading placeholder without a button', () => {
    expect(html).toContain('note-image-loading')
    expect(html).not.toContain('<button')
  })
})
```

`ReactMarkdown` and `renderToStaticMarkup` are already imported at the top of that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/markdown.test.tsx`
Expected: FAIL — `ZoomableImage` is not exported from `./markdown`.

- [ ] **Step 3: Add `ZoomableImage` and route both branches through it**

In `frontend/src/markdown.tsx`:

Extend the React import (currently `import { useEffect, useState } from 'react'`) to include `useCallback`:

```tsx
import { useCallback, useEffect, useState } from 'react'
```

Add the import of the overlay next to the existing `resolveImageUrl` import:

```tsx
import ImageLightbox from './ImageLightbox'
```

Add the wrapper component (place it above `BpadImage`, since `BpadImage` uses it):

```tsx
// Any image in a note opens full-screen when clicked. The <button> wrapper is
// what makes that reachable by keyboard and announced to screen readers —
// cheaper and more correct than tabIndex + role + onKeyDown on the <img>.
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  // Stable identity: ImageLightbox's effects depend on onClose, and a fresh
  // closure each render would re-push a history entry.
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        className="note-image-btn"
        onClick={() => setOpen(true)}
        aria-label={t('images.zoom')}
        type="button"
      >
        <img className="note-image" src={src} alt={alt} loading="lazy" />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={close} />}
    </>
  )
}
```

In `BpadImage`, replace the final `return` (currently the `<img className="note-image" …>` line) with:

```tsx
  return <ZoomableImage src={src} alt={alt || t('images.alt')} />
```

The `failed` and `!src` early returns above it stay exactly as they are — placeholders must remain inert.

In `markdownComponents.img`, replace the fallback `return <img src={src} alt={alt} {...props} />` with:

```tsx
    if (typeof src !== 'string') return <img src={src} alt={alt} {...props} />
    return <ZoomableImage src={src} alt={alt ?? ''} />
```

The `typeof src !== 'string'` guard keeps the renderer honest when markdown yields an image with no usable source; `ZoomableImage` requires a `string`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/markdown.test.tsx`
Expected: PASS — including the pre-existing `bpadUrlTransform` and line-break tests, which must be untouched.

- [ ] **Step 5: Add the CSS**

In `frontend/src/App.css`, add `cursor: zoom-in;` to the existing `.note-image` rule and add the button reset directly below it:

```css
.note-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: block;
  margin: 0.5rem 0;
  cursor: zoom-in;
}
/* Transparent wrapper: the button exists for keyboard and screen-reader
   access, so it must not show up at all. */
.note-image-btn {
  display: block;
  padding: 0;
  border: none;
  background: none;
  cursor: zoom-in;
  max-width: 100%;
}
.note-image-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 6: Verify the whole suite, lint and build**

Run: `cd frontend && npm run test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/markdown.tsx frontend/src/markdown.test.tsx frontend/src/App.css
git commit -m "feat(web): open note images full-screen on click"
```

---

### Task 3: Manual verification and spec status

The effects (Esc, `popstate`/Back, scroll lock) cannot run under `renderToStaticMarkup`, so they get verified by hand. This task ships no code unless the check finds a defect.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-30-zvetseni-obrazku-lightbox-design.md` (status line)

- [ ] **Step 1: Start the API and the frontend**

Two terminals:

```bash
cd api && source .venv/bin/activate && func start
```

```bash
cd frontend && npm run dev
```

The venv must be activated before `func start` — the Python worker resolves from `PATH` and a bare `func start` dies with `ModuleNotFoundError: No module named 'pydantic'`.

- [ ] **Step 2: Create a note with an image**

Log in, create a note, and add an image via the "Add image" button in the editor (or Ctrl+V a screenshot). Save the note.

- [ ] **Step 3: Desktop checks**

In the note detail, confirm each of:

1. Hovering the image shows a zoom-in cursor.
2. Clicking it opens the overlay; the image is centred and fully visible.
3. `Esc` closes it.
4. Clicking the backdrop closes it.
5. Clicking the image itself closes it.
6. The `✕` closes it.
7. `Tab` reaches the image and `Enter` opens it.
8. Open, close, then use the browser's Back button — it must go back to the notes list (one step), not appear to do nothing.
9. In the editor's Preview tab, the same image opens the same way.

- [ ] **Step 4: Mobile checks**

Open the dev server from a phone on the same network (`npm run dev -- --host`), or use device emulation in DevTools:

1. Tap the image — it opens full-screen.
2. The system/browser Back button closes the lightbox and leaves you **in the note**, not on the notes list.
3. Tapping Back again then leaves the note as usual.
4. The page behind does not scroll while the lightbox is open.
5. `✕` is fully visible and tappable, not clipped by the status bar.

- [ ] **Step 5: If anything fails, fix it before continuing**

Use superpowers:systematic-debugging. The most likely failure is the Back button double-stepping — check the `window.history.state?.bpadLightbox` guard in the cleanup of `ImageLightbox`.

- [ ] **Step 6: Mark the spec implemented and commit**

In `docs/superpowers/specs/2026-07-30-zvetseni-obrazku-lightbox-design.md`, change the status line to:

```markdown
**Stav:** implementováno
```

```bash
git add docs/superpowers/specs/2026-07-30-zvetseni-obrazku-lightbox-design.md
git commit -m "docs: mark image lightbox spec implemented"
```
