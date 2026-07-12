import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { LanguageProvider } from './i18n'
import './index.css'
import App from './App.tsx'
import UpdatePrompt from './UpdatePrompt'

// UpdatePrompt registers the service worker (the app runs offline / can be
// installed) and watches for a new version.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <UpdatePrompt />
          <App />
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>,
)
