import { useEffect, useState } from 'react'
import type { Components } from 'react-markdown'
import { resolveImageUrl } from './images'
import { useTranslation } from './i18n'

const BPAD_IMG_PREFIX = 'bpad-img:'

// Resolves a bpad-img:ID source to a short-lived SAS URL and renders it.
function BpadImage({ id, alt }: { id: string; alt: string }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    resolveImageUrl(id)
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [id])

  if (failed) return <span className="note-image-failed">{t('images.failed')}</span>
  if (!src) return <span className="note-image-loading">{t('images.loading')}</span>
  return <img className="note-image" src={src} alt={alt || t('images.alt')} loading="lazy" />
}

// Open links in notes in a new tab (and safely: noopener/noreferrer). Render
// bpad-img: sources through BpadImage; leave normal images to the browser.
export const markdownComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
  img({ node: _node, src, alt, ...props }) {
    if (typeof src === 'string' && src.startsWith(BPAD_IMG_PREFIX)) {
      return <BpadImage id={src.slice(BPAD_IMG_PREFIX.length)} alt={alt ?? ''} />
    }
    return <img src={src} alt={alt} {...props} />
  },
}
