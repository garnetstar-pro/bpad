import { useCallback, useEffect, useState } from 'react'
import type { Components, Options } from 'react-markdown'
import { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { loadImage } from './images'
import ImageLightbox from './ImageLightbox'
import { useTranslation } from './i18n'

// Shared by every place that renders note content, so the detail view and the
// editor preview can never drift apart. remark-breaks makes a single newline a
// <br>: notes are typed as lines, and plain CommonMark would silently join them
// into one running paragraph. A blank line still starts a new paragraph.
export const markdownPlugins: Options['remarkPlugins'] = [remarkGfm, remarkBreaks]

const BPAD_IMG_PREFIX = 'bpad-img:'

// Any image in a note opens full-screen when clicked. The <button> wrapper is
// what makes that reachable by keyboard and announced to screen readers —
// cheaper and more correct than tabIndex + role + onKeyDown on the <img>.
export function ZoomableImage({
  src,
  alt,
  title,
}: {
  src: string
  alt: string
  title?: string
}) {
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
        aria-label={alt ? t('images.zoomNamed', { alt }) : t('images.zoom')}
        type="button"
      >
        <img className="note-image" src={src} alt={alt} title={title} loading="lazy" />
      </button>
      {open && <ImageLightbox src={src} alt={alt} onClose={close} />}
    </>
  )
}

// Resolves a bpad-img:ID source to a short-lived SAS URL and renders it.
function BpadImage({ id, alt }: { id: string; alt: string }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    loadImage(id)
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [id])

  if (failed) return <span className="note-image-failed">{t('images.failed')}</span>
  if (!src) return <span className="note-image-loading">{t('images.loading')}</span>
  return <ZoomableImage src={src} alt={alt || t('images.alt')} />
}

// react-markdown v10 sanitizes src through defaultUrlTransform before our custom
// img renderer runs, blanking any non-standard protocol. Preserve bpad-img: refs
// (BpadImage resolves them to a short-lived SAS URL) and delegate the rest.
export const bpadUrlTransform = (value: string): string =>
  value.startsWith('bpad-img:') ? value : defaultUrlTransform(value)

// Open links in notes in a new tab (and safely: noopener/noreferrer). Render
// bpad-img: sources through BpadImage; leave normal images to the browser.
export const markdownComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
  img({ node: _node, src, alt, title, ...props }) {
    if (typeof src === 'string' && src.startsWith(BPAD_IMG_PREFIX)) {
      return <BpadImage id={src.slice(BPAD_IMG_PREFIX.length)} alt={alt ?? ''} />
    }
    if (typeof src !== 'string') return <img src={src} alt={alt} {...props} />
    return <ZoomableImage src={src} alt={alt ?? ''} title={title} />
  },
}
