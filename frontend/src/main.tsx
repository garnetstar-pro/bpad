import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { LanguageProvider } from './i18n'
import './index.css'
import App from './App.tsx'
import UpdatePrompt from './UpdatePrompt'

// UpdatePrompt registruje service worker (appka běží i offline / jde na plochu)
// a hlídá novou verzi.
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
