import { Routes, Route, Link } from 'react-router-dom'
import { useAuth } from './AuthContext'
import AuthGate from './AuthGate'
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
          <div className="case-number">case file · bpad.pro</div>
          <div className="app-title">bpad</div>
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
