import { useEffect, useRef } from 'react'
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
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab') e.preventDefault()
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
    // Close only when our marker is gone, not on every pop. StrictMode
    // double-invokes this effect in dev: mount #1 pushes L1 and unmounts,
    // queuing an async history.back(); mount #2 pushes L2 before that
    // traversal runs. The traversal then lands on L1 (marker still present),
    // firing popstate on mount #2's listener. An unconditional onClose() here
    // would close the lightbox a frame after it opened, dev-only. Checking
    // the marker tells a real Back (which lands past our entry, no marker)
    // apart from that StrictMode artefact (which lands back on it).
    const onPop = () => {
      if (!window.history.state?.bpadLightbox) onClose()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.bpadLightbox) window.history.back()
    }
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
      onClick={onClose}
    >
      <button
        ref={closeRef}
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
