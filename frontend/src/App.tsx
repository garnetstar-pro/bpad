import { Routes, Route, Link } from 'react-router-dom'
import Home from './Home'
import NoteDetail from './NoteDetail'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          <div className="case-number">case file · bpad.pro</div>
          <div className="app-title">bpad</div>
        </Link>
        <div className="app-meta">access: you only</div>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/notes/:id" element={<NoteDetail />} />
      </Routes>
    </div>
  )
}

export default App
