import { Link } from 'react-router-dom'
import { useTranslation } from './i18n'

// Site-wide footer under every authenticated page. The route to the feature
// overview used to live in DetailFooter, which only renders on desktop next to
// an open note — so on Account, on an empty home and on mobile there was no way
// to reach it. This one is always on screen; the header carries the same link.
export default function AppFooter() {
  const { t } = useTranslation()
  return (
    <footer className="app-footer">
      <Link to="/features" className="app-footer-link">{t('footer.features')}</Link>
      <span className="app-footer-tagline">{t('footer.tagline')}</span>
      <span className="app-footer-copy">{t('footer.copyright')}</span>
    </footer>
  )
}
