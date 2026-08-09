import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { resolveShortcut, isTypingTarget } from './shortcuts'

// Events the shortcuts fire. The panes that own the relevant UI (the composer,
// the search box) listen for these — the handler stays ignorant of where they
// are mounted, which differs between the mobile and desktop layouts.
export const NEW_ENTRY_EVENT = 'bpad:shortcut-new-entry'
export const FOCUS_SEARCH_EVENT = 'bpad:shortcut-focus-search'
export const CLOSE_EVENT = 'bpad:shortcut-close'

// Global keyboard shortcuts, mounted only inside the authenticated tree so
// they can never fire on the lock screen or the landing page.
export default function KeyboardShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The image lightbox is modal and runs its own Escape handling; while it
      // is open the page behind it must not react to anything.
      if (document.querySelector('.lightbox-overlay')) return

      const action = resolveShortcut(e, { typing: isTypingTarget(document.activeElement) })
      if (action === null) return

      switch (action) {
        case 'new':
          e.preventDefault()
          // The composer only exists on the notes screen, so get there first;
          // the listener runs after the route has painted it.
          if (location.pathname !== '/' && !location.pathname.startsWith('/notes/')) navigate('/')
          setTimeout(() => window.dispatchEvent(new Event(NEW_ENTRY_EVENT)), 0)
          break
        case 'search':
          e.preventDefault()
          if (location.pathname !== '/' && !location.pathname.startsWith('/notes/')) navigate('/')
          setTimeout(() => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)), 0)
          break
        case 'close':
          // No preventDefault: Escape may also mean something to whatever has
          // focus, and the listeners below only act when they have something
          // open to close.
          window.dispatchEvent(new Event(CLOSE_EVENT))
          break
        case 'help':
          e.preventDefault()
          navigate('/features')
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, location.pathname])

  return null
}
