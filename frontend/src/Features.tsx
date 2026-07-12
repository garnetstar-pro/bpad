import { Link } from 'react-router-dom'
import { useTranslation } from './i18n'
import { FEATURES } from './featuresData'

export default function Features() {
  const { t } = useTranslation()
  return (
    <div className="detail-page">
      <Link to="/account" className="back-link">{t('common.back')}</Link>

      <div className="account-card">
        <h2 className="account-title">{t('features.title')}</h2>
        <ul className="feature-list">
          {FEATURES.map((f) => (
            <li className="feature-item" key={f.name}>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
