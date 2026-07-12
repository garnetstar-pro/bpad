import BpadMark from './BpadMark'
import { useTranslation } from './i18n'
import { FEATURES } from './featuresData'

// Public landing page shown to visitors before sign-up. The CTAs open the
// auth form in register / login mode (App owns that state).
export default function Landing({
  onGetStarted,
  onLogin,
}: {
  onGetStarted: () => void
  onLogin: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="landing">
      <header className="landing-hero">
        <BpadMark size={72} />
        <h1 className="landing-title">bpad</h1>
        <p className="landing-tagline">{t('landing.tagline')}</p>
        <p className="landing-intro">{t('landing.intro')}</p>
        <div className="landing-cta">
          <button className="landing-primary" onClick={onGetStarted} type="button">
            {t('landing.getStarted')}
          </button>
          <button className="landing-secondary" onClick={onLogin} type="button">
            {t('landing.login')}
          </button>
        </div>
      </header>

      <section className="landing-section">
        <h2 className="landing-h2">{t('landing.featuresHeading')}</h2>
        <ul className="landing-feature-grid">
          {FEATURES.map((f) => (
            <li className="landing-feature" key={f.name}>
              <div className="landing-feature-name">{f.name}</div>
              <div className="landing-feature-desc">{f.desc}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-privacy">
        <h2 className="landing-h2">{t('landing.privacyHeading')}</h2>
        <p className="landing-privacy-body">{t('landing.privacyBody')}</p>
        <button className="landing-primary" onClick={onGetStarted} type="button">
          {t('landing.getStarted')}
        </button>
      </section>

      <footer className="landing-footer">{t('landing.footer')}</footer>
    </div>
  )
}
