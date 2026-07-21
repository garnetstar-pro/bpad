import { Outlet, useMatch } from 'react-router-dom'
import Home from './Home'

// Desktop: list (left) + detail outlet (right), both always visible.
// Mobile: CSS shows one pane at a time — the list, or the detail when a note
// is selected (root gets `has-selection`).
export default function NotesLayout() {
  const selected = useMatch('/notes/:id')
  return (
    <div className={`notes-layout ${selected ? 'has-selection' : ''}`}>
      <div className="list-pane">
        <Home />
      </div>
      <div className="detail-pane">
        <Outlet />
      </div>
    </div>
  )
}
