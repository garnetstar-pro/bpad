import { useNavigate } from 'react-router-dom'
import { useTranslation } from './i18n'
import { FEATURE_CATEGORIES } from './featuresData'
import { SHORTCUTS, EDITOR_SHORTCUTS } from './shortcuts'

export default function Features() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // Reachable from the header on every page, so "back" has to mean wherever the
  // reader came from — not a fixed route. Deep links get the note list instead.
  function goBack() {
    if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }

  return (
    <div className="detail-page">
      <button className="back-link" type="button" onClick={goBack}>{t('common.back')}</button>

      <div className="features-page">
        <h2 className="features-page-title">{t('features.title')}</h2>
        <p className="features-page-intro">{t('features.intro')}</p>

        {/* Rendered from the same table the handler dispatches from
            (shortcuts.ts), so this list cannot drift from the real bindings. */}
        <section className="feature-category" id="shortcuts">
          <h3 className="feature-category-title">{t('shortcuts.title')}</h3>
          <ul className="shortcut-list">
            {[...SHORTCUTS, ...EDITOR_SHORTCUTS].map((s) => (
              <li className="shortcut-row" key={s.keys}>
                <kbd className="key-cap">{s.keys}</kbd>
                <span className="shortcut-desc">{t(s.descKey)}</span>
              </li>
            ))}
          </ul>
          <p className="features-page-intro">{t('shortcuts.note')}</p>
        </section>

        {FEATURE_CATEGORIES.map((cat) => (
          <section className="feature-category" key={cat.title}>
            <h3 className="feature-category-title">{cat.title}</h3>
            <ul className="feature-list">
              {cat.features.map((f) => (
                <li className="feature-item" key={f.name}>
                  <div className="feature-name">{f.name}</div>
                  <div className="feature-desc">{f.desc}</div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
