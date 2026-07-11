import { useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import BpadMark from './BpadMark'
import * as authApi from './authApi'

type Mode = 'login' | 'register' | 'recover'

function Shell({ meta, children }: { meta: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <div className="brand-wrap">
            <BpadMark size={34} />
            <div>
              <div className="brand-kicker">blank pad · encrypted</div>
              <div className="brand">bpad</div>
            </div>
          </div>
          <div className="brand-meta">{meta}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
}: {
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      <input
        className="auth-input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
      />
    </label>
  )
}

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { authenticate } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await authApi.login(username.trim(), password)
      authenticate(username.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Přihlášení se nepovedlo')
      setBusy(false)
    }
  }

  return (
    <Shell meta="access: you only">
      <h2 className="auth-title">Log in</h2>
      <p className="auth-sub">Odemkni svůj šifrovaný trezor.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label="username" value={username} onChange={setUsername} autoFocus disabled={busy} />
        <Field label="heslo" type="password" value={password} onChange={setPassword} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !password}>
          {busy ? 'odemykám…' : 'Log in'}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link" onClick={() => onMode('recover')} type="button">Zapomenuté heslo?</button>
        <button className="auth-link accent" onClick={() => onMode('register')} type="button">Vytvořit účet →</button>
      </div>
      <div className="auth-hint">Klíč se odvodí v prohlížeči a žije jen v paměti. Po zavření karty se přihlásíš znovu.</div>
    </Shell>
  )
}

function RecoveryCodeScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const copy = () => navigator.clipboard?.writeText(code)
  const download = () => {
    const blob = new Blob([`bpad recovery code\n\n${code}\n`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'bpad-recovery-code.txt'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  return (
    <Shell meta="save this">
      <h2 className="auth-title">Tvůj recovery kód</h2>
      <div className="error-banner">
        ⚠ Zapiš si ho teď. Ukáže se jen jednou. Bez hesla i bez tohoto kódu jsou poznámky nenávratně ztracené.
      </div>
      <div className="recovery-code">{code}</div>
      <div className="recovery-actions">
        <button className="ghost-btn" onClick={copy} type="button">Kopírovat</button>
        <button className="ghost-btn" onClick={download} type="button">Stáhnout .txt</button>
      </div>
      <label className="auth-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Kód mám bezpečně uložený
      </label>
      <button className="auth-btn" onClick={onDone} disabled={!saved} type="button">
        Pokračovat do trezoru
      </button>
    </Shell>
  )
}

function RegisterForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { authenticate } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Heslo musí mít aspoň 8 znaků')
    if (password !== confirm) return setError('Hesla se neshodují')
    setBusy(true)
    setError(null)
    try {
      const code = await authApi.register(username.trim(), password)
      setRecoveryCode(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrace se nepovedla')
      setBusy(false)
    }
  }

  if (recoveryCode) {
    return <RecoveryCodeScreen code={recoveryCode} onDone={() => authenticate(username.trim())} />
  }

  return (
    <Shell meta="new vault">
      <h2 className="auth-title">Create account</h2>
      <p className="auth-sub">Založ si soukromý šifrovaný trezor.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label="username" value={username} onChange={setUsername} autoFocus disabled={busy} />
        <Field label="heslo" type="password" value={password} onChange={setPassword} placeholder="zvol silné heslo" disabled={busy} />
        <Field label="heslo znovu" type="password" value={confirm} onChange={setConfirm} placeholder="zopakuj heslo" disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !password}>
          {busy ? 'zakládám trezor…' : 'Create account'}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link accent" onClick={() => onMode('login')} type="button">← Zpět na přihlášení</button>
        <span />
      </div>
      <div className="auth-hint">Heslo nejde obnovit ze serveru. Po vytvoření dostaneš recovery kód — ulož si ho.</div>
    </Shell>
  )
}

function RecoverForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { authenticate } = useAuth()
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError('Nové heslo musí mít aspoň 8 znaků')
    setBusy(true)
    setError(null)
    try {
      await authApi.recover(username.trim(), code, password)
      authenticate(username.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Obnova se nepovedla')
      setBusy(false)
    }
  }

  return (
    <Shell meta="recover">
      <h2 className="auth-title">Obnovit heslo</h2>
      <p className="auth-sub">Zadej recovery kód a nastav nové heslo.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label="username" value={username} onChange={setUsername} autoFocus disabled={busy} />
        <Field label="recovery kód" value={code} onChange={setCode} placeholder="XXXX-XXXX-…" disabled={busy} />
        <Field label="nové heslo" type="password" value={password} onChange={setPassword} placeholder="nové silné heslo" disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !code || !password}>
          {busy ? 'obnovuji…' : 'Obnovit a přihlásit'}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link accent" onClick={() => onMode('login')} type="button">← Zpět na přihlášení</button>
        <span />
      </div>
      <div className="auth-hint">Kód odemkne trezor v prohlížeči a přebalí ho novým heslem. Poznámky se nepřešifrovávají.</div>
    </Shell>
  )
}

export default function AuthGate() {
  const [mode, setMode] = useState<Mode>('login')
  if (mode === 'register') return <RegisterForm onMode={setMode} />
  if (mode === 'recover') return <RecoverForm onMode={setMode} />
  return <LoginForm onMode={setMode} />
}
