import { Outlet, useMatch } from 'react-router-dom'
import Home from './Home'
import NewEntryComposer from './NewEntryComposer'
import { isOfflineReadOnly } from './session'
import { useWideLayout } from './device'

// Desktop: list (left) + detail outlet (right), both always visible. The
// new-entry composer lives above the detail outlet on desktop, so it persists
// across note navigation; on mobile it stays inside Home's list pane.
// Mobile: CSS shows one pane at a time — the list, or the detail when a note
// is selected (root gets `has-selection`).
export default function NotesLayout() {
  const selected = useMatch('/notes/:id')
  const wide = useWideLayout()
  return (
    <div className={`notes-layout ${selected ? 'has-selection' : ''}`}>
      <div className="list-pane">
        <Home />
      </div>
      <div className="detail-pane">
        {wide && !isOfflineReadOnly() && <NewEntryComposer />}
        <Outlet />
      </div>
    </div>
  )
}
