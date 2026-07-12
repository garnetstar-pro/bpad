import { useRegisterSW } from 'virtual:pwa-register/react'

// Upozornění na novou verzi. Registruje service worker; když je připravená
// aktualizace, ukáže lištu s tlačítkem, které na nový SW přepne a obnoví
// stránku (updateServiceWorker(true)). Řeší zaseknutou keš v nainstalované PWA.
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="status">
      <span>Je dostupná nová verze bpad.</span>
      <button className="update-btn" type="button" onClick={() => updateServiceWorker(true)}>
        Aktualizovat
      </button>
      <button
        className="update-dismiss"
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label="Zavřít"
      >
        ×
      </button>
    </div>
  )
}
