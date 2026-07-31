import { useCallback, useEffect, useRef } from 'react'
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
  const closeRef = useRef<HTMLButtonElement>(null)
  // Whether our history entry is still on the stack. A ref, not state: it must
  // survive StrictMode's simulated unmount (same fiber, so the ref keeps its
  // value) and must be readable from the popstate listener without re-binding.
  const owned = useRef(false)

  // Closing by hand (Esc, backdrop, image, the ✕ button) also consumes the
  // history entry we pushed, so the Back button never has to be pressed twice.
  const requestClose = useCallback(() => {
    if (owned.current) {
      owned.current = false
      window.history.back()
    }
    onClose()
  }, [onClose])

  // The close button is the only interactive element inside the dialog, so a
  // full focus trap is just: move focus in on mount, swallow Tab so it can
  // never leave (there's nowhere else inside to go), and give focus back to
  // whatever opened the lightbox on the way out. Without this, Tab reaches
  // the next .note-image-btn behind the overlay and Enter mounts a second
  // ImageLightbox — which then races this one's cleanups (two history.back()
  // calls, and body scroll left permanently locked).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => {
      previouslyFocused?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
      if (e.key === 'Tab') e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  // A history entry so the phone's Back button closes the lightbox instead of
  // leaving the note. The URL does not change, so react-router does not
  // navigate; spreading the existing state preserves the router's own keys.
  //
  // Nothing pops the entry from this cleanup, and that is deliberate: under
  // StrictMode the effect is destroyed and re-created on mount, and a back()
  // queued by that simulated unmount resolves its delta against the entry that
  // was current when it was *called*. It therefore lands one entry below the
  // one the second mount pushed — on the note itself — and fires popstate with
  // our marker already gone, closing the lightbox a frame after it opened
  // (verified in Chrome; dev-only, but that is where the feature is used by
  // hand). Popping belongs to the close paths instead, which run from real user
  // events: requestClose() for Esc/backdrop/✕, and the Back button, which pops
  // the entry itself. The owned ref keeps the push idempotent across the same
  // double-invoke, so exactly one entry exists in dev and in production.
  //
  // Known gap: if the lightbox unmounts without either close path — the parent
  // route going away underneath it — the entry stays behind and one Back press
  // is swallowed. There is no way to tell that unmount from StrictMode's.
  useEffect(() => {
    if (!owned.current) {
      window.history.pushState({ ...window.history.state, bpadLightbox: true }, '')
      owned.current = true
    }
    const onPop = () => {
      owned.current = false
      onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [onClose])

  // Keep the page behind from scrolling. Neither html nor body sets its own
  // overflow, so this locks the whole viewport on both mobile and desktop —
  // the note's detail column has no inner scroller of its own (see App.css),
  // it just scrolls with the page. The one leak: a wheel over the left-hand
  // list pane still scrolls that list, because .list-pane .entries is its own
  // scroll container and this lock doesn't reach into it.
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
    <span
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t('images.alt')}
      onClick={requestClose}
    >
      <button
        ref={closeRef}
        className="lightbox-close"
        onClick={requestClose}
        aria-label={t('images.close')}
        type="button"
      >
        ✕
      </button>
      <img className="lightbox-image" src={src} alt={alt} />
    </span>
  )
}
