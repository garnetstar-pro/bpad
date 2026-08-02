import { useState, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import BpadMark from './BpadMark'
import { canAutofocus } from './device'
import * as authApi from './authApi'
import { createNote } from './api'
import { welcomeNoteMarkdown } from './welcomeNote'
import { useTranslation } from './i18n'

export type Mode = 'login' | 'register' | 'recover'

function Shell({ meta, children }: { meta: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <div className="brand-wrap">
            <BpadMark size={34} />
            <div>
              <div className="brand-kicker">{t('auth.brandKicker')}</div>
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

// `name` and `autoComplete` are required, not defaulted: a password manager that
// can't fill or save is a real hazard here, because a forgotten password means
// the vault is gone for good. Every field has to say what it holds — use "off"
// only where filling would be wrong (the recovery code).
function Field({
  label,
  name,
  autoComplete,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoFocus,
  disabled,
}: {
  label: string
  name: string
  autoComplete: string
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
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete={autoComplete}
      />
    </label>
  )
}

function LoginForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { t } = useTranslation()
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
      setError(err instanceof Error ? err.message : t('auth.errLogin'))
      setBusy(false)
    }
  }

  return (
    <Shell meta={t('auth.metaAccess')}>
      <h2 className="auth-title">{t('auth.login')}</h2>
      <p className="auth-sub">{t('auth.loginSub')}</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label={t('auth.username')} name="username" autoComplete="username" value={username} onChange={setUsername} autoFocus={canAutofocus()} disabled={busy} />
        <Field label={t('auth.password')} name="password" autoComplete="current-password" type="password" value={password} onChange={setPassword} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !password}>
          {busy ? t('auth.unlocking') : t('auth.login')}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link" onClick={() => onMode('recover')} type="button">{t('auth.forgotPassword')}</button>
        <button className="auth-link accent" onClick={() => onMode('register')} type="button">{t('auth.toRegister')}</button>
      </div>
      <div className="auth-hint">{t('auth.loginHint')}</div>
    </Shell>
  )
}

function RecoveryCodeScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useTranslation()
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
    <Shell meta={t('auth.metaSave')}>
      <h2 className="auth-title">{t('auth.recoveryTitle')}</h2>
      <div className="error-banner">
        {t('auth.recoveryWarn')}
      </div>
      <div className="recovery-code">{code}</div>
      <div className="recovery-actions">
        <button className="ghost-btn" onClick={copy} type="button">{t('auth.copy')}</button>
        <button className="ghost-btn" onClick={download} type="button">{t('auth.download')}</button>
      </div>
      <label className="auth-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('auth.recoverySaved')}
      </label>
      <button className="auth-btn" onClick={onDone} disabled={!saved} type="button">
        {t('auth.toVault')}
      </button>
    </Shell>
  )
}

function RegisterForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { t } = useTranslation()
  const { authenticate } = useAuth()
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [solving, setSolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(t('auth.errEmail'))
    if (password.length < 8) return setError(t('auth.errPwLen'))
    if (password !== confirm) return setError(t('auth.errPwMatch'))
    setBusy(true)
    setError(null)
    try {
      const code = await authApi.register(
        username.trim(), email.trim(), password, () => setSolving(true),
      )
      // Welcome demo note (encrypted, best-effort — must not block registration).
      createNote(welcomeNoteMarkdown(window.location.host)).catch(() => {})
      setRecoveryCode(code)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.errRegister'))
      setSolving(false)
      setBusy(false)
    }
  }

  if (recoveryCode) {
    return <RecoveryCodeScreen code={recoveryCode} onDone={() => authenticate(username.trim())} />
  }

  return (
    <Shell meta={t('auth.metaNewVault')}>
      <h2 className="auth-title">{t('auth.createAccount')}</h2>
      <p className="auth-sub">{t('auth.createSub')}</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label={t('auth.username')} name="username" autoComplete="username" value={username} onChange={setUsername} autoFocus={canAutofocus()} disabled={busy} />
        <Field label={t('auth.email')} name="email" autoComplete="email" type="email" value={email} onChange={setEmail} placeholder={t('auth.emailPlaceholder')} disabled={busy} />
        <Field label={t('auth.password')} name="new-password" autoComplete="new-password" type="password" value={password} onChange={setPassword} placeholder={t('auth.strongPassword')} disabled={busy} />
        <Field label={t('auth.passwordAgain')} name="confirm-password" autoComplete="new-password" type="password" value={confirm} onChange={setConfirm} placeholder={t('auth.repeatPassword')} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !password}>
          {solving ? t('auth.solvingRobot') : busy ? t('auth.creatingVault') : t('auth.createAccount')}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link accent" onClick={() => onMode('login')} type="button">{t('auth.backToLogin')}</button>
        <span />
      </div>
      <div className="auth-hint">{t('auth.registerHint')}</div>
    </Shell>
  )
}

function RecoverForm({ onMode }: { onMode: (m: Mode) => void }) {
  const { t } = useTranslation()
  const { authenticate } = useAuth()
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return setError(t('auth.errNewPwLen'))
    setBusy(true)
    setError(null)
    try {
      await authApi.recover(username.trim(), code, password)
      authenticate(username.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.errRecover'))
      setBusy(false)
    }
  }

  return (
    <Shell meta={t('auth.metaRecover')}>
      <h2 className="auth-title">{t('auth.recoverTitle')}</h2>
      <p className="auth-sub">{t('auth.recoverSub')}</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={submit}>
        <Field label={t('auth.username')} name="username" autoComplete="username" value={username} onChange={setUsername} autoFocus={canAutofocus()} disabled={busy} />
        {/* The recovery code is written down, not stored by a password manager. */}
        <Field label={t('auth.recoveryCode')} name="recovery-code" autoComplete="off" value={code} onChange={setCode} placeholder="XXXX-XXXX-…" disabled={busy} />
        <Field label={t('auth.newPassword')} name="new-password" autoComplete="new-password" type="password" value={password} onChange={setPassword} placeholder={t('auth.newPasswordPlaceholder')} disabled={busy} />
        <button className="auth-btn" type="submit" disabled={busy || !username || !code || !password}>
          {busy ? t('auth.recovering') : t('auth.recoverSubmit')}
        </button>
      </form>
      <div className="auth-links">
        <button className="auth-link accent" onClick={() => onMode('login')} type="button">{t('auth.backToLogin')}</button>
        <span />
      </div>
      <div className="auth-hint">{t('auth.recoverHint')}</div>
    </Shell>
  )
}

export default function AuthGate({
  initialMode = 'login',
  onBack,
}: {
  initialMode?: Mode
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>(initialMode)
  const form =
    mode === 'register' ? (
      <RegisterForm onMode={setMode} />
    ) : mode === 'recover' ? (
      <RecoverForm onMode={setMode} />
    ) : (
      <LoginForm onMode={setMode} />
    )
  return (
    <>
      {onBack && (
        <button className="landing-back" onClick={onBack} type="button">
          {t('common.back')}
        </button>
      )}
      {form}
    </>
  )
}
