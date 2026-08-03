# Nastavitelný auto-lock timeout — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uživatel si může nastavit, po jaké době nečinnosti se vault zamkne (1/5/15/30/60 min nebo nikdy), a to jak na desktopu, tak na mobilu.

**Architecture:** Přidáme pole `auto_lock_minutes` na server (`User` model + `PreferencesRequest` + `/auth/me`), rozšíříme frontend preferences helper o `getAutoLockPref`/`setAutoLockPref`, odstraníme hardcoded timeout z `AuthContext` a přidáme dropdown na Account stránce. Sentinel `0` = nikdy, `null` = nenastaveno (použij device default: desktop 5 min, mobil nikdy).

**Tech Stack:** Python 3.12 / Pydantic (API), TypeScript / React (frontend), pytest, vitest

---

## Mapování souborů

| Soubor | Změna |
|---|---|
| `api/models.py` | Přidat `auto_lock_minutes` do `User`; přidat `autoLockMinutes` do `PreferencesRequest` |
| `api/function_app.py` | `me` handler vrátí `autoLockMinutes`; `update_preferences` handler uloží `autoLockMinutes` |
| `api/test_preferences.py` | Rozšířit stávající testy |
| `frontend/src/preferences.ts` | Přidat `getAutoLockPref`, `setAutoLockPref`, `deviceDefaultAutoLock` |
| `frontend/src/preferences.test.ts` | Nový testový soubor |
| `frontend/src/authApi.ts` | `Account` interface + `getAccount` sync + `savePreferences` |
| `frontend/src/AuthContext.tsx` | Odstranit hardcoded `IDLE_TIMEOUT_MS`, odebrat `isTouchPrimary()` check, číst preferenci |
| `frontend/src/Account.tsx` | Přidat dropdown auto-lock |
| `frontend/src/i18n/en.ts` | Přidat klíče `account.autoLock*` |

---

## Task 1: API — `auto_lock_minutes` na `User` modelu a v `/auth/me`

**Files:**
- Modify: `api/models.py:55-74`
- Modify: `api/function_app.py:339-357`
- Modify: `api/test_preferences.py`

- [ ] **Krok 1: Napsat failing test**

Otevři `api/test_preferences.py`. Nahraď celý obsah:

```python
import pytest
from pydantic import ValidationError
from models import PreferencesRequest, User


def test_preferences_accepts_known_values():
    assert PreferencesRequest(sortBy="created").sortBy == "created"
    assert PreferencesRequest(sortBy="modified").sortBy == "modified"


def test_preferences_rejects_unknown_value():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="alphabetical")


def test_preferences_accepts_auto_lock_minutes():
    r = PreferencesRequest(sortBy="created", autoLockMinutes=15)
    assert r.autoLockMinutes == 15


def test_preferences_accepts_auto_lock_zero_never():
    r = PreferencesRequest(sortBy="created", autoLockMinutes=0)
    assert r.autoLockMinutes == 0


def test_preferences_rejects_negative_auto_lock():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="created", autoLockMinutes=-1)


def test_preferences_auto_lock_optional():
    # autoLockMinutes is optional; omitting it is valid
    r = PreferencesRequest(sortBy="created")
    assert r.autoLockMinutes is None


def test_user_auto_lock_default_is_none():
    u = User(
        username="x", salt="s", recovery_salt="rs", auth_hash="h", rec_auth_hash="rh",
        wrapped_data_key_pw={"iv": "iv", "ct": "ct"},
        wrapped_data_key_rec={"iv": "iv", "ct": "ct"},
    )
    assert u.auto_lock_minutes is None
```

- [ ] **Krok 2: Spustit test — musí selhat**

```bash
cd api && source .venv/bin/activate && python -m pytest test_preferences.py -v
```

Očekávaný výstup: FAIL (pole `autoLockMinutes` a `auto_lock_minutes` neexistují).

- [ ] **Krok 3: Přidat `auto_lock_minutes` do `User` v `api/models.py`**

Najdi třídu `User` (řádek 55). Za řádek `sort_by: str = "created"` přidej:

```python
    # Non-secret UI preference: idle-lock timeout in minutes. 0 = never; None = not
    # set by user yet (device picks its own default: 5 min on desktop, never on mobile).
    auto_lock_minutes: Optional[int] = None
```

- [ ] **Krok 4: Přidat `autoLockMinutes` do `PreferencesRequest` v `api/models.py`**

Najdi třídu `PreferencesRequest` (řádek 114):

```python
class PreferencesRequest(BaseModel):
    sortBy: Literal["created", "modified"]
```

Nahraď za:

```python
class PreferencesRequest(BaseModel):
    sortBy: Literal["created", "modified"]
    # Optional: only present when the user changes the auto-lock setting.
    # 0 = never; None = not sent (don't change the stored value); positive int = minutes.
    autoLockMinutes: Optional[int] = Field(default=None, ge=0)
```

Přidej `Field` do importu na řádku 1 — je tam už (`from pydantic import BaseModel, Field`), zkontroluj.

- [ ] **Krok 5: Spustit test**

```bash
cd api && source .venv/bin/activate && python -m pytest test_preferences.py -v
```

Očekávaný výstup: všechny testy PASS.

- [ ] **Krok 6: Rozšířit `me` handler o `autoLockMinutes`**

Najdi handler `me` v `api/function_app.py` (řádky 339–357). Aktuální `return _json(...)`:

```python
    return _json(
        {
            "username": user.username,
            "email": user.email,
            "emailVerified": user.email_verified,
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "sortBy": user.sort_by,
            "maxImagesPerNote": user.max_images_per_note,
        },
        200,
    )
```

Nahraď za:

```python
    return _json(
        {
            "username": user.username,
            "email": user.email,
            "emailVerified": user.email_verified,
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "sortBy": user.sort_by,
            "maxImagesPerNote": user.max_images_per_note,
            "autoLockMinutes": user.auto_lock_minutes,
        },
        200,
    )
```

- [ ] **Krok 7: Rozšířit `update_preferences` handler**

Najdi handler `update_preferences` (řádky 360–374). Aktuální tělo:

```python
    user.sort_by = data.sortBy
    users_repo.save_user(user)
    return _json({"sortBy": user.sort_by}, 200)
```

Nahraď za:

```python
    user.sort_by = data.sortBy
    if data.autoLockMinutes is not None:
        user.auto_lock_minutes = data.autoLockMinutes
    users_repo.save_user(user)
    return _json({"sortBy": user.sort_by, "autoLockMinutes": user.auto_lock_minutes}, 200)
```

- [ ] **Krok 8: Spustit celou API suite**

```bash
cd api && source .venv/bin/activate && python -m pytest -v
```

Očekávaný výstup: všechny testy PASS (žádný nový FAIL).

- [ ] **Krok 9: Commit**

```bash
git add api/models.py api/function_app.py api/test_preferences.py
git commit -m "feat: add auto_lock_minutes to User model and preferences API

GET /auth/me now returns autoLockMinutes (null = not set = device default).
PUT /auth/preferences accepts optional autoLockMinutes (0 = never, positive = minutes).
Negative values are rejected by Pydantic validation."
```

---

## Task 2: Frontend — `preferences.ts` rozšíření + testy

**Files:**
- Modify: `frontend/src/preferences.ts`
- Create: `frontend/src/preferences.test.ts`

- [ ] **Krok 1: Napsat failing test**

Vytvoř soubor `frontend/src/preferences.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'

// Stub localStorage (tests run in Node without jsdom).
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
}
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true })

// Stub session username.
vi.mock('./session', () => ({ getUsername: () => 'alice' }))

// Stub isTouchPrimary — default: desktop (false).
let mockIsTouch = false
vi.mock('./device', () => ({ isTouchPrimary: () => mockIsTouch }))

import { vi } from 'vitest'
import {
  getAutoLockPref,
  setAutoLockPref,
  deviceDefaultAutoLock,
} from './preferences'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
  mockIsTouch = false
})

describe('deviceDefaultAutoLock', () => {
  it('returns 5 on desktop', () => {
    mockIsTouch = false
    expect(deviceDefaultAutoLock()).toBe(5)
  })

  it('returns null on touch device', () => {
    mockIsTouch = true
    expect(deviceDefaultAutoLock()).toBeNull()
  })
})

describe('getAutoLockPref', () => {
  it('returns device default when nothing stored', () => {
    mockIsTouch = false
    expect(getAutoLockPref()).toBe(5)
  })

  it('returns stored value when present', () => {
    setAutoLockPref(30)
    expect(getAutoLockPref()).toBe(30)
  })

  it('returns null (never) when 0 stored', () => {
    setAutoLockPref(0)
    expect(getAutoLockPref()).toBeNull()
  })
})

describe('setAutoLockPref', () => {
  it('persists minutes to localStorage', () => {
    setAutoLockPref(15)
    expect(getAutoLockPref()).toBe(15)
  })

  it('persists null (never) as sentinel 0', () => {
    setAutoLockPref(null)
    expect(getAutoLockPref()).toBeNull()
  })
})
```

- [ ] **Krok 2: Spustit test — musí selhat**

```bash
cd frontend && npm run test -- preferences.test.ts
```

Očekávaný výstup: FAIL (`getAutoLockPref` is not exported).

- [ ] **Krok 3: Rozšířit `frontend/src/preferences.ts`**

Přidej importy a funkce. Nový celý obsah souboru:

```typescript
// Non-secret UI preferences. Cached in localStorage (per user) for instant,
// offline-tolerant reads; the server is the source of truth (seeded via
// getAccount, written via savePreferences in authApi).
import { getUsername } from './session'
import { isTouchPrimary } from './device'

export type SortField = 'created' | 'modified'

const sortKey = (u: string) => `bpad.pref.sort.${u}`
const autoLockKey = (u: string) => `bpad.pref.autolock.${u}`

// Sentinel stored in localStorage for "never lock" (distinguishable from
// "nothing stored yet"). Server uses 0 for the same purpose.
const NEVER_SENTINEL = '0'

export function getSortPref(): SortField {
  const u = getUsername()
  if (!u) return 'created'
  return localStorage.getItem(sortKey(u)) === 'modified' ? 'modified' : 'created'
}

export function setSortPref(field: SortField): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(sortKey(u), field)
  } catch {
    /* quota / private mode – best-effort */
  }
}

/**
 * Device-specific default timeout in minutes.
 * Desktop: 5 minutes (preserves current behaviour).
 * Touch/mobile: null = never (preserves current behaviour).
 */
export function deviceDefaultAutoLock(): number | null {
  return isTouchPrimary() ? null : 5
}

/**
 * Get the current auto-lock timeout in minutes, or null for "never".
 * Falls back to deviceDefaultAutoLock() when the user has not yet set a preference.
 */
export function getAutoLockPref(): number | null {
  const u = getUsername()
  if (!u) return deviceDefaultAutoLock()
  const raw = localStorage.getItem(autoLockKey(u))
  if (raw === null) return deviceDefaultAutoLock()
  const n = parseInt(raw, 10)
  if (isNaN(n)) return deviceDefaultAutoLock()
  return n === 0 ? null : n
}

/**
 * Persist the auto-lock timeout.
 * Pass null to mean "never lock"; pass a positive number for minutes.
 */
export function setAutoLockPref(minutes: number | null): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(autoLockKey(u), minutes === null ? NEVER_SENTINEL : String(minutes))
  } catch {
    /* quota / private mode – best-effort */
  }
}
```

- [ ] **Krok 4: Spustit test**

```bash
cd frontend && npm run test -- preferences.test.ts
```

Očekávaný výstup: všechny testy PASS.

- [ ] **Krok 5: Celá frontend test suite**

```bash
cd frontend && npm run test
```

Žádný nový FAIL.

- [ ] **Krok 6: Commit**

```bash
git add frontend/src/preferences.ts frontend/src/preferences.test.ts
git commit -m "feat: add getAutoLockPref / setAutoLockPref to preferences

Reads/writes auto-lock timeout (minutes | null) to localStorage per user.
Sentinel 0 = never. Falls back to deviceDefaultAutoLock() (desktop 5 min,
mobile null) when nothing is stored."
```

---

## Task 3: Frontend — `authApi.ts` sync preference ze serveru

**Files:**
- Modify: `frontend/src/authApi.ts`

- [ ] **Krok 1: Rozšířit `Account` interface**

Najdi v `frontend/src/authApi.ts` interface `Account` (řádky 34–41):

```typescript
export interface Account {
  username: string
  email: string | null
  emailVerified: boolean
  createdAt: string | null
  sortBy: SortField
  maxImagesPerNote: number
}
```

Nahraď za:

```typescript
export interface Account {
  username: string
  email: string | null
  emailVerified: boolean
  createdAt: string | null
  sortBy: SortField
  maxImagesPerNote: number
  autoLockMinutes: number | null  // null = not set = use device default
}
```

- [ ] **Krok 2: Rozšířit `getAccount()` — syncovat `autoLockMinutes`**

Přidej import `setAutoLockPref, deviceDefaultAutoLock` do řádku s importem z `./preferences`:

```typescript
import { setSortPref, setAutoLockPref, deviceDefaultAutoLock, type SortField } from './preferences'
```

Najdi funkci `getAccount()` (řádky 43–53). Aktuálně:

```typescript
  const account: Account = await res.json()
  setSortPref(account.sortBy)
  setMaxImagesPerNote(account.maxImagesPerNote)
  return account
```

Nahraď za:

```typescript
  const account: Account = await res.json()
  setSortPref(account.sortBy)
  setMaxImagesPerNote(account.maxImagesPerNote)
  // Sync auto-lock preference from server. null = user hasn't set it → keep device default.
  if (account.autoLockMinutes !== null) {
    setAutoLockPref(account.autoLockMinutes)
  }
  return account
```

- [ ] **Krok 3: Rozšířit `savePreferences()` — posílat `autoLockMinutes`**

Najdi funkci `savePreferences()` (řádky 55–63):

```typescript
export async function savePreferences(sortBy: SortField): Promise<void> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/preferences`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(token ? { 'X-Auth-Token': token } : {}) },
    body: JSON.stringify({ sortBy }),
  })
  if (!res.ok) throw new Error(translate('errors.preferencesSaveFailed'))
}
```

Nahraď za:

```typescript
export async function savePreferences(
  sortBy: SortField,
  autoLockMinutes?: number | null,
): Promise<void> {
  const token = getToken()
  const body: Record<string, unknown> = { sortBy }
  if (autoLockMinutes !== undefined) body.autoLockMinutes = autoLockMinutes
  const res = await fetch(`${AUTH_URL}/preferences`, {
    method: 'PUT',
    headers: { ...JSON_HEADERS, ...(token ? { 'X-Auth-Token': token } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(translate('errors.preferencesSaveFailed'))
}
```

- [ ] **Krok 4: Buildový check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Očekávaný výstup: build projde bez TypeScript chyb.

- [ ] **Krok 5: Commit**

```bash
git add frontend/src/authApi.ts
git commit -m "feat: sync autoLockMinutes from server via getAccount/savePreferences

Account interface gains autoLockMinutes. getAccount() seeds the localStorage
preference when server has a value. savePreferences() accepts optional
autoLockMinutes as second parameter."
```

---

## Task 4: Frontend — `AuthContext.tsx` dynamický timeout

**Files:**
- Modify: `frontend/src/AuthContext.tsx`

- [ ] **Krok 1: Přečíst aktuální soubor a rozumět mu**

Aktuální `AuthContext.tsx` má na řádku 21 hardcoded:
```typescript
const IDLE_TIMEOUT_MS = 5 * 60 * 1000
```
A na řádku 42 skip pro touch:
```typescript
if (username === null || locked || isTouchPrimary()) return
```

Obojí odstraníme. Timeout se čte z `getAutoLockPref()` a přepočítá na ms. `null` = nikdy = efekt vrátí cleanup bez nastavení timeru.

- [ ] **Krok 2: Upravit `AuthContext.tsx`**

Nový celý obsah souboru:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearSession } from './session'
import { rememberUser, forgetRememberedUser } from './rememberedUser'
import { getAutoLockPref } from './preferences'

interface AuthState {
  username: string | null
  isAuthenticated: boolean
  // Idle-locked: session keys cleared, username remembered → show the lock screen.
  locked: boolean
  // Called after a successful login/registration/recovery (the session is already set).
  authenticate: (username: string) => void
  logout: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)

  // When the API hits a 401 (expired token), send the user back to login.
  useEffect(() => {
    const onUnauthorized = () => {
      setLocked(false)
      setUsername(null)
    }
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

  // Idle lock. Clears in-memory keys and shows the lock screen; the username is
  // kept for a quick password re-auth.
  // Timeout comes from user preference (getAutoLockPref). null = never = no lock.
  // Primary trigger: leaving the tab/window and coming back after the timeout.
  // Also locks after the timeout of foreground inactivity.
  // Re-evaluated on username/locked change AND when the user updates the preference
  // (bpad:lockpref-changed event re-triggers by updating a state counter).
  useEffect(() => {
    if (username === null || locked) return
    const autoLockMinutes = getAutoLockPref()
    if (autoLockMinutes === null) return  // "never" — don't install the timer
    const timeoutMs = autoLockMinutes * 60_000

    let last = Date.now()
    let awayAt: number | null = null
    const lock = () => {
      clearSession()
      setLocked(true)
    }
    const bump = () => { last = Date.now() }
    const idleCheck = () => { if (Date.now() - last > timeoutMs) lock() }
    // Tab hidden or window blurred → remember when we left.
    const leave = () => { if (awayAt === null) awayAt = Date.now() }
    // Back on the tab/window → lock if we were away long enough.
    const back = () => {
      if (awayAt !== null) {
        const away = Date.now() - awayAt
        awayAt = null
        if (away >= timeoutMs) return lock()
      }
      last = Date.now() // fresh start; don't lock from a stale foreground timer
    }
    const onVisibility = () =>
      document.visibilityState === 'hidden' ? leave() : back()

    const activity = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    activity.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(idleCheck, 30_000)
    return () => {
      activity.forEach((e) => window.removeEventListener(e, bump))
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [username, locked])

  // Re-run the idle-lock effect when the user changes the auto-lock preference.
  useEffect(() => {
    const onPrefChanged = () => {
      // Force re-mount of the idle-lock effect by toggling locked briefly is wrong;
      // instead we use a separate state counter as a dependency.
      // This is handled by including _prefVersion in the effect dependency — see below.
    }
    window.addEventListener('bpad:lockpref-changed', onPrefChanged)
    return () => window.removeEventListener('bpad:lockpref-changed', onPrefChanged)
  }, [])

  const value: AuthState = {
    username,
    isAuthenticated: username !== null,
    locked,
    authenticate: (u) => {
      rememberUser(u)
      setLocked(false)
      setUsername(u)
    },
    logout: () => {
      forgetRememberedUser()
      clearSession()
      setLocked(false)
      setUsername(null)
    },
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
```

Poznámka: `bpad:lockpref-changed` event listener je přidán pro budoucí okamžitou reaktivitu, ale samotný re-mount efektu závisí na `[username, locked]`. Při změně preference se timeout projeví ihned (protože `getAutoLockPref()` se čte uvnitř efektu vždy znovu — ale efekt se znovu nespustí bez změny závislostí). Čistší řešení: přidat `prefVersion` state counter, který se inkrementuje při `bpad:lockpref-changed`, a přidat ho do závislostí idle-lock efektu. Implementuj to takto:

Nahraď celý soubor tímto finálním kódem:

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearSession } from './session'
import { rememberUser, forgetRememberedUser } from './rememberedUser'
import { getAutoLockPref } from './preferences'

interface AuthState {
  username: string | null
  isAuthenticated: boolean
  locked: boolean
  authenticate: (username: string) => void
  logout: () => void
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  // Incremented by bpad:lockpref-changed to re-run the idle-lock effect immediately.
  const [prefVersion, setPrefVersion] = useState(0)

  useEffect(() => {
    const onUnauthorized = () => {
      setLocked(false)
      setUsername(null)
    }
    window.addEventListener('bpad:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bpad:unauthorized', onUnauthorized)
  }, [])

  // Re-run idle-lock effect when user changes the preference from Account page.
  useEffect(() => {
    const onPrefChanged = () => setPrefVersion((v) => v + 1)
    window.addEventListener('bpad:lockpref-changed', onPrefChanged)
    return () => window.removeEventListener('bpad:lockpref-changed', onPrefChanged)
  }, [])

  // Idle lock. null timeout = never. Works on all devices (desktop + mobile).
  useEffect(() => {
    if (username === null || locked) return
    const autoLockMinutes = getAutoLockPref()
    if (autoLockMinutes === null) return
    const timeoutMs = autoLockMinutes * 60_000

    let last = Date.now()
    let awayAt: number | null = null
    const lock = () => { clearSession(); setLocked(true) }
    const bump = () => { last = Date.now() }
    const idleCheck = () => { if (Date.now() - last > timeoutMs) lock() }
    const leave = () => { if (awayAt === null) awayAt = Date.now() }
    const back = () => {
      if (awayAt !== null) {
        const away = Date.now() - awayAt
        awayAt = null
        if (away >= timeoutMs) return lock()
      }
      last = Date.now()
    }
    const onVisibility = () =>
      document.visibilityState === 'hidden' ? leave() : back()

    const activity = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    activity.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    window.addEventListener('blur', leave)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(idleCheck, 30_000)
    return () => {
      activity.forEach((e) => window.removeEventListener(e, bump))
      window.removeEventListener('blur', leave)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [username, locked, prefVersion])

  const value: AuthState = {
    username,
    isAuthenticated: username !== null,
    locked,
    authenticate: (u) => {
      rememberUser(u)
      setLocked(false)
      setUsername(u)
    },
    logout: () => {
      forgetRememberedUser()
      clearSession()
      setLocked(false)
      setUsername(null)
    },
  }

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
```

- [ ] **Krok 3: Buildový check + testy**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Očekávaný výstup: build projde bez chyb.

```bash
cd frontend && npm run test
```

Žádný nový FAIL.

- [ ] **Krok 4: Commit**

```bash
git add frontend/src/AuthContext.tsx
git commit -m "feat: replace hardcoded idle timeout with dynamic getAutoLockPref()

Removes IDLE_TIMEOUT_MS constant and isTouchPrimary() guard. Timeout now
comes from user preference (null = never = no lock). Works on desktop and
mobile alike. bpad:lockpref-changed event triggers immediate re-evaluation."
```

---

## Task 5: i18n — přidat klíče pro auto-lock

**Files:**
- Modify: `frontend/src/i18n/en.ts`

- [ ] **Krok 1: Přidat klíče do `account` sekce**

Otevři `frontend/src/i18n/en.ts`. Najdi v `account` objektu řádek s `language: 'language',` (okolo řádku 136). Za něj přidej:

```typescript
    autoLock: 'Auto-lock',
    autoLockNever: 'Never',
    autoLock1: '1 minute',
    autoLock5: '5 minutes',
    autoLock15: '15 minutes',
    autoLock30: '30 minutes',
    autoLock60: '1 hour',
```

- [ ] **Krok 2: Buildový check**

```bash
cd frontend && npm run build 2>&1 | tail -5
```

Očekávaný výstup: build projde.

- [ ] **Krok 3: Commit**

```bash
git add frontend/src/i18n/en.ts
git commit -m "feat: add i18n keys for auto-lock preference UI"
```

---

## Task 6: UI — dropdown na Account stránce

**Files:**
- Modify: `frontend/src/Account.tsx`

- [ ] **Krok 1: Přidat import a helper pro zobrazení hodnoty**

Otevři `frontend/src/Account.tsx`. Na začátek importů přidej:

```typescript
import {
  getSortPref,
  getAutoLockPref,
  setAutoLockPref,
  type SortField,
} from './preferences'
```

(Zkontroluj, jestli `preferences` import už existuje — pokud ano, jen rozšiř destructuring.)

Přidej import `savePreferences` rozšíř o — zkontroluj existující import z `./authApi`:
```typescript
import { getAccount, resendVerification, savePreferences, type Account as AccountData } from './authApi'
```
(Toto by mělo být tak jak je, savePreferences už je importováno.)

- [ ] **Krok 2: Přidat state pro auto-lock do komponenty `Account`**

Najdi v `Account.tsx` řádek kde jsou useState deklarace (okolo řádku 23). Za řádek:
```typescript
  const [account, setAccount] = useState<AccountData | null>(null)
```
Přidej:
```typescript
  const [autoLock, setAutoLock] = useState<number | null>(() => getAutoLockPref())
```

- [ ] **Krok 3: Přidat handler pro změnu auto-lock**

Za existující funkce (např. za `submitFeedback`), přidej:

```typescript
  async function handleAutoLockChange(value: string) {
    const minutes = value === 'never' ? null : parseInt(value, 10)
    // Sentinel: null → 0 for server, positive number directly.
    const serverValue = minutes === null ? 0 : minutes
    setAutoLock(minutes)
    setAutoLockPref(minutes)
    window.dispatchEvent(new Event('bpad:lockpref-changed'))
    // Best-effort server sync — same pattern as sortBy preference.
    savePreferences(account?.sortBy ?? 'created', serverValue).catch(() => {})
  }
```

- [ ] **Krok 4: Přidat dropdown do JSX**

Najdi v JSX blok s language dropdown (okolo řádku 123–136):

```tsx
        {availableLocales().length > 1 && (
          <div className="account-row">
            <span className="account-key">{t('account.language')}</span>
            <select ...>
```

Za tento blok (po uzavíracím `)}`) přidej:

```tsx
        <div className="account-row">
          <span className="account-key">{t('account.autoLock')}</span>
          <select
            className="account-val"
            value={autoLock === null ? 'never' : String(autoLock)}
            onChange={(e) => handleAutoLockChange(e.target.value)}
          >
            <option value="never">{t('account.autoLockNever')}</option>
            <option value="1">{t('account.autoLock1')}</option>
            <option value="5">{t('account.autoLock5')}</option>
            <option value="15">{t('account.autoLock15')}</option>
            <option value="30">{t('account.autoLock30')}</option>
            <option value="60">{t('account.autoLock60')}</option>
          </select>
        </div>
```

- [ ] **Krok 5: Buildový check**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Očekávaný výstup: build projde bez TypeScript chyb.

- [ ] **Krok 6: Lint**

```bash
cd frontend && npm run lint 2>&1 | tail -20
```

Žádné nové chyby.

- [ ] **Krok 7: Testy**

```bash
cd frontend && npm run test
```

Žádný nový FAIL.

- [ ] **Krok 8: Commit**

```bash
git add frontend/src/Account.tsx
git commit -m "feat: add auto-lock timeout dropdown to Account page

Users can now choose: Never / 1 / 5 / 15 / 30 / 60 minutes.
Change takes effect immediately (bpad:lockpref-changed event) and syncs
to server via PUT /auth/preferences."
```

---

## Self-Review

### Spec coverage

| Požadavek | Task |
|---|---|
| `auto_lock_minutes` na `User` modelu | Task 1 |
| `autoLockMinutes` v `/auth/me` | Task 1 |
| `autoLockMinutes` v `/auth/preferences` PUT + validace ≥ 0 | Task 1 |
| `getAutoLockPref` / `setAutoLockPref` / `deviceDefaultAutoLock` | Task 2 |
| Sentinel 0 = nikdy | Task 2 |
| Device default: desktop 5 min, mobil null | Task 2 |
| `getAccount()` syncuje `autoLockMinutes` | Task 3 |
| `savePreferences()` posílá `autoLockMinutes` | Task 3 |
| Odstranit hardcoded `IDLE_TIMEOUT_MS` | Task 4 |
| Odstranit `isTouchPrimary()` guard | Task 4 |
| `prefVersion` counter pro okamžitou reaktivitu | Task 4 |
| i18n klíče | Task 5 |
| Dropdown na Account stránce | Task 6 |
| Stávající chování zachováno (desktop default 5 min, mobil nikdy) | Task 2 + 4 |

### Typ konzistence
- `autoLockMinutes: number | null` — konzistentní v `Account` interface, `savePreferences`, `getAutoLockPref`, `setAutoLockPref`, `handleAutoLockChange`.
- Sentinel `0` = nikdy — použit konzistentně: server ukládá `0`, klient překládá `0` → `null` v `getAutoLockPref`, posílá `0` v `handleAutoLockChange`.
- `prefVersion` — přidán do `useEffect` závislostí v Task 4.
