import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { LanguageProvider } from './i18n'
import './index.css'
import App from './App.tsx'
import UpdatePrompt from './UpdatePrompt'
import UndoDeleteToast from './UndoDeleteToast'

// UpdatePrompt registers the service worker (the app runs offline / can be
// installed) and watches for a new version. UndoDeleteToast sits at the root
// because deleting a note navigates away from the route that triggered it.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <UpdatePrompt />
          <UndoDeleteToast />
          <App />
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>,
)
