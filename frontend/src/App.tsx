import { Routes, Route, Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import AuthGate from './AuthGate'
import BpadMark from './BpadMark'
import Home from './Home'
import NoteDetail from './NoteDetail'
import './App.css'

function App() {
  const { isAuthenticated, username, logout } = useAuth()

  if (!isAuthenticated) return <AuthGate />

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          <BpadMark size={48} />
          <div>
            <div className="case-number">blank pad · encrypted</div>
            <div className="app-title">bpad</div>
          </div>
        </Link>
        <div className="app-meta">
          {username}
          <br />
          <button className="logout-link" onClick={logout} type="button">log out</button>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/notes/:id" element={<NoteDetail />} />
      </Routes>
    </div>
  )
}

export default App
