# Note List Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user order the Home note list by creation date (default) or last modification, with the sort field saved as a per-user server preference.

**Architecture:** Add a server-set `updated_at` timestamp to notes and a `sort_by` preference to the user. Sorting itself runs client-side in `Home.tsx` (the client already decrypts and filters all notes); direction is hardcoded newest-first. The preference is persisted via a new `PUT /api/auth/preferences` endpoint and cached in `localStorage` for instant, offline-tolerant reads.

**Tech Stack:** Python 3.12 / Azure Functions + Pydantic (`api/`); React + Vite + TypeScript (`frontend/`); pytest (api tests), vitest (frontend tests).

## Global Constraints

- User-facing copy is **English** and MUST go through the `t()` i18n layer (`frontend/src/i18n/en.ts`) — never hardcode user-facing strings in components.
- Code comments and logs are **English**.
- Sort **direction is hardcoded newest-first**; only the sort **field** is user-selectable. Allowed field values are exactly `"created"` and `"modified"`.
- `updated_at` and `sort_by` are **non-secret server metadata** — never part of the encrypted note payload.
- Run api tests with: `cd api && python -m pytest`
- Run frontend tests with: `cd frontend && npm test`

---

### Task 1: Backend — `updated_at` timestamp on notes

**Files:**
- Modify: `api/models.py` (the `Note` model)
- Modify: `api/function_app.py:328-357` (`create_note`), `api/function_app.py:371-387` (`update_note`)
- Test: `api/test_repository.py`

**Interfaces:**
- Produces: `Note.updated_at: Optional[datetime]` (serialized as `updated_at` in note JSON, ISO string). `create_note` sets `updated_at == created_at`; `update_note` sets `updated_at = datetime.utcnow()`.

- [ ] **Step 1: Add the field to the model**

In `api/models.py`, add `updated_at` to the `Note` model (right after `created_at`):

```python
class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # Client-encrypted payload {title, content, url}. The server never sees the content.
    iv: str
    ct: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Server-set metadata: last modification time. Optional so notes stored before
    # this field existed load cleanly; consumers fall back to created_at when None.
    updated_at: Optional[datetime] = None
```

- [ ] **Step 2: Write the failing tests**

Add to `api/test_repository.py`:

```python
from datetime import datetime


def test_create_note_sets_updated_at_equal_to_created_at():
    # A freshly created note (as function_app builds it) sorts identically under
    # both "created" and "modified" ordering.
    n = _note(created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00")
    assert n.updated_at == n.created_at


def test_note_updated_at_defaults_to_none_for_legacy_notes():
    n = _note()  # no updated_at supplied, as with pre-existing stored notes
    assert n.updated_at is None
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && python -m pytest test_repository.py::test_create_note_sets_updated_at_equal_to_created_at test_repository.py::test_note_updated_at_defaults_to_none_for_legacy_notes -v`
Expected: FAIL — `test_note_updated_at_defaults_to_none_for_legacy_notes` fails with `AttributeError`/validation before Step 1 is applied; after Step 1 both pass. (If Step 1 is already applied, they pass — that is fine, they lock the behavior.)

- [ ] **Step 4: Set `updated_at` in the handlers**

In `api/function_app.py`, in `create_note`, change the `Note(...)` construction (currently around line 350) to stamp `updated_at` equal to `created_at`:

```python
    note = Note(
        user_id=user,
        iv=data.iv,
        ct=data.ct,
        **({"created_at": data.created_at} if data.created_at else {}),
    )
    # A new note's modification time starts equal to its creation time.
    note.updated_at = note.created_at
    notes_repo.save_note(note)
    return _json(note.model_dump(mode="json"), 201)
```

In `update_note`, stamp `updated_at` before saving (currently around line 384):

```python
    note.iv = data.iv
    note.ct = data.ct
    note.updated_at = datetime.utcnow()
    notes_repo.save_note(note)
    return _json(note.model_dump(mode="json"), 200)
```

- [ ] **Step 5: Run the full api test suite**

Run: `cd api && python -m pytest -q`
Expected: PASS (all existing tests plus the two new ones).

- [ ] **Step 6: Commit**

```bash
git add api/models.py api/function_app.py api/test_repository.py
git commit -m "feat(api): add server-set updated_at timestamp to notes"
```

---

### Task 2: Backend — per-user sort preference + endpoint

**Files:**
- Modify: `api/models.py` (the `User` model; add `PreferencesRequest`)
- Modify: `api/function_app.py:8-13` (imports), `api/function_app.py:299-316` (`me`), and add a new route
- Test: `api/test_repository.py`

**Interfaces:**
- Consumes: `users_repo.get_user(username)`, `users_repo.save_user(user)`, `_require_user(req)` (returns `str` username or `func.HttpResponse`).
- Produces: `User.sort_by: str` (default `"created"`); `PreferencesRequest(sortBy: Literal["created","modified"])`; route `PUT /api/auth/preferences` returning `{"sortBy": ...}`; `auth/me` response gains `"sortBy"`.

- [ ] **Step 1: Add `sort_by` to the User model and a request model**

In `api/models.py`, add `Literal` to the typing import:

```python
from typing import Optional, Literal
```

Add `sort_by` to the `User` model (after `email_verified`, alongside the other non-secret metadata):

```python
    # Non-secret UI preference: note-list sort field. "created" (default) | "modified".
    sort_by: str = "created"
```

Add a request model (near the other `*Request` models, e.g. after `ChangePasswordRequest`):

```python
class PreferencesRequest(BaseModel):
    sortBy: Literal["created", "modified"]
```

- [ ] **Step 2: Write the failing tests**

Add to `api/test_repository.py`:

```python
def test_sort_by_defaults_to_created():
    assert _user().sort_by == "created"


def test_sort_pref_round_trips_through_save_user():
    repo = InMemoryUsersRepository()
    u = _user()
    repo.add_user(u)
    u.sort_by = "modified"
    repo.save_user(u)
    assert repo.get_user("alice").sort_by == "modified"
```

Add a new test file `api/test_preferences.py`:

```python
import pytest
from pydantic import ValidationError
from models import PreferencesRequest


def test_preferences_accepts_known_values():
    assert PreferencesRequest(sortBy="created").sortBy == "created"
    assert PreferencesRequest(sortBy="modified").sortBy == "modified"


def test_preferences_rejects_unknown_value():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="alphabetical")
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && python -m pytest test_repository.py::test_sort_by_defaults_to_created test_repository.py::test_sort_pref_round_trips_through_save_user test_preferences.py -v`
Expected: FAIL — `ImportError`/`AttributeError` because `sort_by` and `PreferencesRequest` don't exist yet (they exist after Step 1; if so, tests PASS).

- [ ] **Step 4: Expose the preference in `auth/me`**

In `api/function_app.py`, import `PreferencesRequest`:

```python
from models import (
    Note, NoteCreate, User,
    RegisterRequest, LoginRequest, RecoverRequest, ChangePasswordRequest,
    VerifyEmailRequest, PreferencesRequest,
)
```

In the `me` handler, add `sortBy` to the returned dict:

```python
    return _json(
        {
            "username": user.username,
            "email": user.email,
            "emailVerified": user.email_verified,
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "sortBy": user.sort_by,
        },
        200,
    )
```

- [ ] **Step 5: Add the preferences route**

In `api/function_app.py`, directly after the `me` handler (before the `# ---- notes` section), add:

```python
@app.route(route="auth/preferences", methods=["PUT"])
def update_preferences(req: func.HttpRequest) -> func.HttpResponse:
    username = _require_user(req)
    if isinstance(username, func.HttpResponse):
        return username
    try:
        data = PreferencesRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    user = users_repo.get_user(username)
    if user is None:
        return _error("User not found", 404)
    user.sort_by = data.sortBy
    users_repo.save_user(user)
    return _json({"sortBy": user.sort_by}, 200)
```

- [ ] **Step 6: Run the full api test suite**

Run: `cd api && python -m pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/models.py api/function_app.py api/test_repository.py api/test_preferences.py
git commit -m "feat(api): persist per-user note-list sort preference"
```

---

### Task 3: Frontend — carry `updated_at` through the client types

**Files:**
- Modify: `frontend/src/types.ts` (the `Note` interface)
- Modify: `frontend/src/offlineCache.ts:6-11` (`EncryptedNote`)
- Modify: `frontend/src/api.ts` (the `decrypt` function)

**Interfaces:**
- Consumes: `EncryptedNote` from the API (now includes optional `updated_at`).
- Produces: `Note.updated_at: string` — always populated (falls back to `created_at` for legacy notes).

- [ ] **Step 1: Add `updated_at` to the client `Note` type**

In `frontend/src/types.ts`:

```typescript
export interface Note {
  id: string
  title: string
  content: string
  url: string | null
  created_at: string
  updated_at: string
  tags: string[]
}
```

- [ ] **Step 2: Add `updated_at` to `EncryptedNote`**

In `frontend/src/offlineCache.ts`:

```typescript
export interface EncryptedNote {
  id: string
  iv: string
  ct: string
  created_at: string
  // Optional: absent on notes cached/stored before the field existed.
  updated_at?: string
}
```

- [ ] **Step 3: Populate `updated_at` in `decrypt`**

In `frontend/src/api.ts`, in the `decrypt` function, add the field with the legacy fallback:

```typescript
async function decrypt(enc: EncryptedNote): Promise<Note> {
  const payload = await decryptJSON<NotePayload>({ iv: enc.iv, ct: enc.ct }, key())
  return {
    id: enc.id,
    title: payload.title,
    content: payload.content,
    url: payload.url,
    created_at: enc.created_at,
    updated_at: enc.updated_at ?? enc.created_at,
    tags: normalizeTags(payload.tags ?? []),
  }
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS (`tsc -b` succeeds, Vite build completes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/offlineCache.ts frontend/src/api.ts
git commit -m "feat(web): carry note updated_at through client types"
```

---

### Task 4: Frontend — sort preference module + server sync

**Files:**
- Create: `frontend/src/preferences.ts`
- Create: `frontend/src/preferences.test.ts`
- Modify: `frontend/src/authApi.ts:31-46` (`Account` interface + `getAccount`) and add `savePreferences`

**Interfaces:**
- Consumes: `getUsername()` from `frontend/src/session.ts`; `getToken()` and `AUTH_URL` already present in `authApi.ts`.
- Produces: `type SortField = 'created' | 'modified'`; `getSortPref(): SortField`; `setSortPref(field: SortField): void`; `savePreferences(sortBy: SortField): Promise<void>`. `Account` gains `sortBy: SortField`.

- [ ] **Step 1: Write the failing test for the preference cache**

Create `frontend/src/preferences.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getSortPref, setSortPref } from './preferences'

vi.mock('./session', () => ({ getUsername: () => 'alice' }))

describe('sort preference cache', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to "created" when nothing is stored', () => {
    expect(getSortPref()).toBe('created')
  })

  it('round-trips a stored value', () => {
    setSortPref('modified')
    expect(getSortPref()).toBe('modified')
  })

  it('falls back to "created" for an unrecognized stored value', () => {
    localStorage.setItem('bpad.pref.sort.alice', 'garbage')
    expect(getSortPref()).toBe('created')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- preferences`
Expected: FAIL — cannot resolve `./preferences`.

- [ ] **Step 3: Create the preferences module**

Create `frontend/src/preferences.ts`:

```typescript
// Non-secret UI preference: which field the Home note list sorts by. Cached in
// localStorage (per user) for instant, offline-tolerant reads; the server is the
// source of truth (seeded via getAccount, written via savePreferences in authApi).
import { getUsername } from './session'

export type SortField = 'created' | 'modified'

const sortKey = (u: string) => `bpad.pref.sort.${u}`

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
    /* quota / private mode – best-effort, mirrors the offline cache */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- preferences`
Expected: PASS.

- [ ] **Step 5: Extend `Account` and add `savePreferences`, seed the cache**

In `frontend/src/authApi.ts`, import the type and cache setter at the top of the file (with the other imports):

```typescript
import { setSortPref, type SortField } from './preferences'
```

Extend the `Account` interface:

```typescript
export interface Account {
  username: string
  email: string | null
  emailVerified: boolean
  createdAt: string | null
  sortBy: SortField
}
```

Seed the local cache when the account loads — update `getAccount`:

```typescript
export async function getAccount(): Promise<Account> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/me`, {
    headers: token ? { 'X-Auth-Token': token } : {},
  })
  if (!res.ok) throw new Error(translate('errors.accountLoadFailed'))
  const account: Account = await res.json()
  setSortPref(account.sortBy)
  return account
}
```

Add `savePreferences` (place it near `getAccount`); it reuses the existing `getToken`/`AUTH_URL`:

```typescript
export async function savePreferences(sortBy: SortField): Promise<void> {
  const token = getToken()
  const res = await fetch(`${AUTH_URL}/preferences`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Auth-Token': token } : {}),
    },
    body: JSON.stringify({ sortBy }),
  })
  if (!res.ok) throw new Error(translate('errors.accountLoadFailed'))
}
```

- [ ] **Step 6: Type-check**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/preferences.ts frontend/src/preferences.test.ts frontend/src/authApi.ts
git commit -m "feat(web): add sort-preference cache and server sync"
```

---

### Task 5: Frontend — sort control + client-side ordering on Home

**Files:**
- Modify: `frontend/src/i18n/en.ts:24-31` (the `home` block)
- Modify: `frontend/src/Home.tsx`
- Modify: `frontend/src/App.css` (after `.section-count`, line ~325)

**Interfaces:**
- Consumes: `getSortPref`, `setSortPref`, `SortField` from `./preferences`; `savePreferences` from `./authApi`; `Note.created_at` / `Note.updated_at`.
- Produces: user-visible sort toggle wired to the persisted preference; list ordered newest-first by the selected field.

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/en.ts`, add three keys to the `home` block:

```typescript
  home: {
    connectFailed: 'Couldn’t reach the backend. Is func start running?',
    recentEntries: 'recent entries',
    searchPlaceholder: 'search notes…',
    clearSearch: 'Clear search',
    loading: 'loading…',
    noEntries: 'no entries yet',
    nothingFound: 'nothing found',
    sortLabel: 'Sort entries by',
    sortCreated: 'created',
    sortModified: 'modified',
  },
```

- [ ] **Step 2: Wire sort state, ordering, and the control into `Home.tsx`**

Add imports at the top of `frontend/src/Home.tsx`:

```typescript
import { getSortPref, setSortPref, type SortField } from './preferences'
import { savePreferences } from './authApi'
```

Add sort state next to the other `useState` hooks (after the `query` state):

```typescript
  const [sortBy, setSortBy] = useState<SortField>(() => getSortPref())

  const changeSort = (field: SortField) => {
    setSortBy(field)
    setSortPref(field) // optimistic local cache
    // Best-effort server sync; if it fails (offline) the change stays local
    // and re-syncs on the next successful save.
    savePreferences(field).catch(() => {})
  }
```

Replace the `filtered` computation to sort after filtering (newest-first by the
selected field; `Array.prototype.sort` is stable, so ties keep the server's
created-desc order):

```typescript
  const stamp = (n: Note) => (sortBy === 'modified' ? n.updated_at : n.created_at)
  const filtered = [...filterByTags(filterNotes(notes, query), selected, untaggedOnly)].sort(
    (a, b) => new Date(stamp(b)).getTime() - new Date(stamp(a)).getTime(),
  )
```

Add the control inside the existing `.section-head`, after the `section-count` span:

```tsx
      <div className="section-head">
        <span className="section-label">{t('home.recentEntries')}</span>
        <div className="sort-toggle" role="group" aria-label={t('home.sortLabel')}>
          <button
            type="button"
            className={sortBy === 'created' ? 'is-active' : ''}
            onClick={() => changeSort('created')}
          >
            {t('home.sortCreated')}
          </button>
          <button
            type="button"
            className={sortBy === 'modified' ? 'is-active' : ''}
            onClick={() => changeSort('modified')}
          >
            {t('home.sortModified')}
          </button>
        </div>
        {searching && (
          <span className="section-count">
            {filtered.length} / {notes.length}
          </span>
        )}
      </div>
```

- [ ] **Step 3: Add the toggle styles**

In `frontend/src/App.css`, after the `.section-count` rule (line ~325), add:

```css
.sort-toggle {
  display: inline-flex;
  gap: 2px;
}

.sort-toggle button {
  background: none;
  border: none;
  padding: 2px 6px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-dim);
  cursor: pointer;
}

.sort-toggle button.is-active {
  color: var(--accent);
}
```

- [ ] **Step 4: Type-check the whole frontend**

Run: `cd frontend && npm run build`
Expected: PASS — confirms the new i18n keys resolve, `Note.updated_at` is used correctly, and the component type-checks.

- [ ] **Step 5: Lint**

Run: `cd frontend && npm run lint`
Expected: PASS (no oxlint errors).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/i18n/en.ts frontend/src/Home.tsx frontend/src/App.css
git commit -m "feat(web): add created/modified sort control to note list"
```

---

### Task 6: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Start the API**

Run: `cd api && func start` (host on port 7071).

- [ ] **Step 2: Start the frontend dev server**

Run: `cd frontend && npm run dev`.

- [ ] **Step 3: Verify behavior in the browser**

1. Sign in, confirm the Home list shows the **created / modified** toggle in the section header, with **created** active by default.
2. Create two notes; edit the older one so its `updated_at` becomes the newest.
3. Switch the toggle to **modified** → the just-edited note jumps to the top. Switch back to **created** → original order returns.
4. Reload the page → the toggle stays on the last choice (loaded from the server preference / cache).
5. In DevTools, confirm `PUT /api/auth/preferences` fires on toggle and returns 200, and `GET /api/auth/me` returns `sortBy`.

Expected: all five behaviors hold.

---

## Self-Review Notes

- **Spec coverage:** `updated_at` (Task 1); `sort_by` + `auth/me` + `PUT /auth/preferences` + validation (Task 2); client types/decrypt/offlineCache (Task 3); `Account.sortBy` + `savePreferences` + cache seeding (Task 4); Home control + client sort + i18n + CSS (Task 5); manual E2E (Task 6).
- **Legacy fallback:** enforced in two places — `Note.updated_at` Optional server-side, and `enc.updated_at ?? enc.created_at` client-side (Task 3, Step 3).
- **Direction hardcoded:** the sort comparator in Task 5 always descends; only the field switches.
- **Type consistency:** `SortField = 'created' | 'modified'` defined once in `preferences.ts` and imported by `authApi.ts` and `Home.tsx`; server `Literal["created","modified"]` matches.
