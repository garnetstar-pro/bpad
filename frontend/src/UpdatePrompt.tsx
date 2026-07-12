import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from './i18n'

// New-version notice. Registers the service worker; when an update is
// ready, shows a banner with a button that switches to the new SW and
// reloads the page (updateServiceWorker(true)). Fixes a stuck cache in the
// installed PWA.
export default function UpdatePrompt() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="status">
      <span>{t('update.available')}</span>
      <button className="update-btn" type="button" onClick={() => updateServiceWorker(true)}>
        {t('update.refresh')}
      </button>
      <button
        className="update-dismiss"
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label={t('update.dismiss')}
      >
        ×
      </button>
    </div>
  )
}
