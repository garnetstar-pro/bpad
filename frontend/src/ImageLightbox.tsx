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
