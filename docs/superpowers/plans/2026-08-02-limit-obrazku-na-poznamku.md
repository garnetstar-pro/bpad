# Per-user image-per-note limit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap how many images one note may reference — default 10, per-user, stored on the user document in Cosmos and changeable only there — enforced on both the server and the client.

**Architecture:** The server can't read a note, so the only place it learns the image count is the `image_ids` array the client sends on save; `create_note`/`update_note` reject a payload over the user's quota with a 403 before anything is written. The quota travels to the browser in `auth/me`, is cached in `localStorage` next to the other per-user client state, and the editor uses it to disable image insertion before any upload starts.

**Tech Stack:** Python 3.12 + Azure Functions + Pydantic (`api/`), pytest; React + TypeScript + Vite (`frontend/`), vitest without jsdom.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-02-limit-obrazku-na-poznamku-design.md`. Read it before starting.
- **Default limit: 10.** The constant name is `_DEFAULT_MAX_IMAGES_PER_NOTE` (Python) / `DEFAULT_MAX_IMAGES_PER_NOTE` (TypeScript).
- **The limit is never writable through the API.** No endpoint may set `max_images_per_note`; `PreferencesRequest` stays exactly as it is. It is changed by hand in the Cosmos `users` container.
- **User-facing copy is English and goes through `t()`/`translate()`** — never hardcode a user-facing string in a component. Server error strings are English and returned verbatim to the client.
- **Code comments and log messages are English.** Design docs are Czech.
- **Python tests:** run from `api/` with the venv active: `source .venv/bin/activate && python -m pytest`.
- **Frontend tests:** run from `frontend/`: `npx vitest run <file>`. There is **no jsdom** — a test that touches `document`, `localStorage` or `window` stubs the global itself.
- **Counting rule:** distinct ids. `len(set(image_ids))` on the server, `parseImageIds(draft).length` on the client (that helper already deduplicates).
- **Do not modify** `backupImport.ts` — a 403 on one note is already handled as a non-fatal per-note failure, which is the wanted behaviour.

---

## File Structure

**Server (`api/`)**
- `models.py` — add `User.max_images_per_note: int = 10` (modify)
- `function_app.py` — default constant, two small helpers, guards in `create_note` / `update_note`, `maxImagesPerNote` in `auth/me` (modify)
- `test_image_limit.py` — **new**, the whole feature's server tests (helpers + routes), with its own `_req` builder in the style of `test_image_routes.py`

**Client (`frontend/src/`)**
- `entitlements.ts` — add the cached per-user limit (modify)
- `entitlements.test.ts` — **new**
- `authApi.ts` — `Account.maxImagesPerNote`, cached by `getAccount()` (modify)
- `Editor.tsx` — count images in the draft, disable insertion at the limit (modify)
- `Editor.test.tsx` — **new**
- `i18n/en.ts` — `editor.imageLimit` (modify)
- `api.ts` — `updateNote()` surfaces the server's error message (modify)

**Docs**
- `CLAUDE.md` — one sentence about the limit in the images paragraph (modify, last task)

---

## Task 1: The quota field on the user, exposed by `auth/me`

**Files:**
- Modify: `api/models.py` (the `User` model)
- Modify: `api/function_app.py` (the `me` route, ~line 336)
- Test: `api/test_image_limit.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `User.max_images_per_note: int` (default `10`); `GET /api/auth/me` response gains the key `"maxImagesPerNote"` (int). Task 2 reads the field, Task 3 reads the JSON key.

- [ ] **Step 1: Write the failing test**

Create `api/test_image_limit.py`:

```python
import json

import azure.functions as func

import auth
import function_app as fa
from models import Encrypted, User


def _req(method, url, body=None, token=None, route_params=None):
    headers = {"X-Auth-Token": token} if token else {}
    return func.HttpRequest(
        method=method, url=url, headers=headers, route_params=route_params or {},
        body=json.dumps(body).encode() if body is not None else None,
    )


def _add_user(username, **kw):
    """Register a user directly in the repository, bypassing the register route."""
    enc = Encrypted(iv="i", ct="c")
    user = User(
        username=username,
        salt="s",
        recovery_salt="rs",
        auth_hash="ah",
        rec_auth_hash="rah",
        wrapped_data_key_pw=enc,
        wrapped_data_key_rec=enc,
        **kw,
    )
    fa.users_repo.add_user(user)
    return user


def test_user_defaults_to_ten_images_per_note():
    assert _add_user("lim-default").max_images_per_note == 10


def test_me_reports_the_default_limit():
    _add_user("lim-me-default")
    res = fa.me(_req("GET", "/api/auth/me", token=auth.create_token("lim-me-default")))
    assert res.status_code == 200
    assert json.loads(res.get_body())["maxImagesPerNote"] == 10


def test_me_reports_a_hand_edited_limit():
    _add_user("lim-me-custom", max_images_per_note=25)
    res = fa.me(_req("GET", "/api/auth/me", token=auth.create_token("lim-me-custom")))
    assert json.loads(res.get_body())["maxImagesPerNote"] == 25


def test_saving_preferences_does_not_clobber_the_limit():
    _add_user("lim-prefs", max_images_per_note=25)
    token = auth.create_token("lim-prefs")
    res = fa.update_preferences(
        _req("PUT", "/api/auth/preferences", {"sortBy": "modified"}, token)
    )
    assert res.status_code == 200
    assert fa.users_repo.get_user("lim-prefs").max_images_per_note == 25
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && source .venv/bin/activate && python -m pytest test_image_limit.py -v`
Expected: FAIL — `test_user_defaults_to_ten_images_per_note` raises `TypeError`/`ValidationError` for the unknown keyword, and the `me` tests fail with `KeyError: 'maxImagesPerNote'`.

- [ ] **Step 3: Add the field to the `User` model**

In `api/models.py`, in `class User`, right after the `sort_by` field:

```python
    # Non-secret per-user quota: how many distinct images one note may reference.
    # Deliberately not writable through any endpoint — change it by hand in the
    # Cosmos `users` container (Azure Data Explorer).
    max_images_per_note: int = 10
```

- [ ] **Step 4: Expose it from `auth/me`**

In `api/function_app.py`, in the `me` route's `_json({...}, 200)` payload, after `"sortBy": user.sort_by,`:

```python
            "maxImagesPerNote": user.max_images_per_note,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && source .venv/bin/activate && python -m pytest test_image_limit.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the whole API suite**

Run: `cd api && source .venv/bin/activate && python -m pytest`
Expected: PASS — no existing test breaks (the field has a default, so stored documents and existing fixtures load unchanged).

- [ ] **Step 7: Commit**

```bash
git add api/models.py api/function_app.py api/test_image_limit.py
git commit -m "feat(api): per-user max_images_per_note, reported by auth/me"
```

---

## Task 2: Server enforcement on note create and update

**Files:**
- Modify: `api/function_app.py` (constant + helpers near `_note_limit_hit`, guards in `create_note` and `update_note`)
- Test: `api/test_image_limit.py` (append)

**Interfaces:**
- Consumes: `User.max_images_per_note` from Task 1.
- Produces: `fa._DEFAULT_MAX_IMAGES_PER_NOTE == 10`, `fa._image_limit(user: Optional[User]) -> int`, `fa._image_limit_exceeded(image_ids, limit: int) -> bool`; `POST /api/notes` and `PUT /api/notes/{id}` answer `403` with `{"error": "A note can hold at most N images."}` when the payload is over quota.

- [ ] **Step 1: Write the failing tests**

Append to `api/test_image_limit.py`:

```python
# --- helpers ---

def test_image_limit_falls_back_to_the_default_without_a_user():
    assert fa._image_limit(None) == fa._DEFAULT_MAX_IMAGES_PER_NOTE == 10


def test_image_limit_reads_the_users_own_quota():
    assert fa._image_limit(_add_user("lim-helper", max_images_per_note=3)) == 3


def test_image_limit_exceeded_only_past_the_cap():
    assert fa._image_limit_exceeded(["a"] * 10, 10) is False
    assert fa._image_limit_exceeded(["a"] * 11, 10) is True


def test_image_limit_counts_distinct_ids():
    # The same picture used three times in one note is one image.
    assert fa._image_limit_exceeded(["a", "a", "a"], 1) is False


# --- routes ---

def _note_body(image_ids):
    return {"iv": "x" * 16, "ct": "c" * 10, "image_ids": image_ids}


def test_create_note_allows_exactly_the_limit():
    _add_user("lim-create-ok")
    token = auth.create_token("lim-create-ok")
    res = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(10)]), token))
    assert res.status_code == 201


def test_create_note_rejects_one_over_the_limit():
    _add_user("lim-create-no")
    token = auth.create_token("lim-create-no")
    res = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(11)]), token))
    assert res.status_code == 403
    assert "at most 10 images" in json.loads(res.get_body())["error"]
    # Nothing was written.
    assert fa.notes_repo.count_notes("lim-create-no") == 0


def test_create_note_honours_a_hand_edited_quota():
    _add_user("lim-create-25", max_images_per_note=25)
    token = auth.create_token("lim-create-25")
    ok = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(25)]), token))
    assert ok.status_code == 201
    over = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(26)]), token))
    assert over.status_code == 403
    assert "at most 25 images" in json.loads(over.get_body())["error"]


def test_update_note_rejects_one_over_the_limit_and_keeps_the_note():
    _add_user("lim-update")
    token = auth.create_token("lim-update")
    created = json.loads(
        fa.create_note(_req("POST", "/api/notes", _note_body(["keep"]), token)).get_body()
    )
    note_id = created["id"]

    body = _note_body([f"i{n}" for n in range(11)])
    body["ct"] = "replacement"
    res = fa.update_note(
        _req("PUT", f"/api/notes/{note_id}", body, token, route_params={"id": note_id})
    )
    assert res.status_code == 403
    assert fa.notes_repo.get_note("lim-update", note_id).ct == "c" * 10


def test_update_note_allows_exactly_the_limit():
    _add_user("lim-update-ok")
    token = auth.create_token("lim-update-ok")
    created = json.loads(
        fa.create_note(_req("POST", "/api/notes", _note_body([]), token)).get_body()
    )
    note_id = created["id"]
    res = fa.update_note(
        _req("PUT", f"/api/notes/{note_id}", _note_body([f"i{n}" for n in range(10)]),
             token, route_params={"id": note_id})
    )
    assert res.status_code == 200
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && source .venv/bin/activate && python -m pytest test_image_limit.py -v`
Expected: FAIL — `AttributeError: module 'function_app' has no attribute '_image_limit'`, and the route tests return `201`/`200` instead of `403`.

- [ ] **Step 3: Add the constant and the helpers**

In `api/function_app.py`, next to the other quota constants near the top (after `_PENDING_IMAGE_TTL`):

```python
_DEFAULT_MAX_IMAGES_PER_NOTE = 10  # fallback when the user record can't be read
```

And directly below the existing `_note_limit_hit()` function:

```python
def _image_limit(user: Optional[User]) -> int:
    """The user's images-per-note quota; hand-edited in Cosmos, never via the API."""
    return user.max_images_per_note if user else _DEFAULT_MAX_IMAGES_PER_NOTE


def _image_limit_exceeded(image_ids, limit: int) -> bool:
    """Distinct ids: the same picture used repeatedly in one note counts once."""
    return len(set(image_ids)) > limit
```

- [ ] **Step 4: Guard `create_note`**

In `create_note`, the user record is already loaded as `account` for the note-count check. Add this **after** the `hit == "hard"` branch and **before** `note = Note(...)`:

```python
    limit = _image_limit(account)
    if _image_limit_exceeded(data.image_ids, limit):
        return _error(f"A note can hold at most {limit} images.", 403)
```

- [ ] **Step 5: Guard `update_note`**

In `update_note`, after the `NoteCreate(**req.get_json())` parsing block and **before** `note.iv = data.iv`:

```python
    limit = _image_limit(users_repo.get_user(user))
    if _image_limit_exceeded(data.image_ids, limit):
        return _error(f"A note can hold at most {limit} images.", 403)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && source .venv/bin/activate && python -m pytest test_image_limit.py -v`
Expected: PASS (12 tests)

- [ ] **Step 7: Run the whole API suite**

Run: `cd api && source .venv/bin/activate && python -m pytest`
Expected: PASS. `test_image_routes.py` creates notes for users that have no record at all — those fall back to the default 10 and use at most one image, so they stay green.

- [ ] **Step 8: Commit**

```bash
git add api/function_app.py api/test_image_limit.py
git commit -m "feat(api): reject notes referencing more images than the user's quota"
```

---

## Task 3: Client-side cache of the limit

**Files:**
- Modify: `frontend/src/entitlements.ts`
- Modify: `frontend/src/authApi.ts` (the `Account` interface and `getAccount()`)
- Test: `frontend/src/entitlements.test.ts` (create)

**Interfaces:**
- Consumes: the `maxImagesPerNote` key in the `auth/me` response (Task 1).
- Produces: `DEFAULT_MAX_IMAGES_PER_NOTE: number`, `getMaxImagesPerNote(): number`, `setMaxImagesPerNote(limit: number): void` exported from `./entitlements`; `Account.maxImagesPerNote: number`. Task 4 calls `getMaxImagesPerNote()`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/entitlements.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DEFAULT_MAX_IMAGES_PER_NOTE,
  getMaxImagesPerNote,
  setMaxImagesPerNote,
} from './entitlements'

// vitest runs in the node environment (no DOM); stub localStorage with a Map,
// mirroring preferences.test.ts.
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

// Mutable so a test can switch users; hoisted, because vi.mock runs first.
const session = vi.hoisted(() => ({ username: 'alice' as string | null }))
vi.mock('./session', () => ({ getUsername: () => session.username }))

describe('images-per-note quota cache', () => {
  beforeEach(() => {
    store.clear()
    session.username = 'alice'
  })

  it('defaults to 10 when nothing is stored', () => {
    expect(DEFAULT_MAX_IMAGES_PER_NOTE).toBe(10)
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('round-trips a stored value', () => {
    setMaxImagesPerNote(25)
    expect(getMaxImagesPerNote()).toBe(25)
  })

  it('keeps each user’s quota separate', () => {
    setMaxImagesPerNote(25)
    session.username = 'bob'
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('falls back to the default for a junk stored value', () => {
    store.set('bpad.limit.images.alice', 'lots')
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('falls back to the default when signed out', () => {
    session.username = null
    expect(getMaxImagesPerNote()).toBe(10)
  })

  it('ignores a write while signed out', () => {
    session.username = null
    setMaxImagesPerNote(25)
    session.username = 'alice'
    expect(getMaxImagesPerNote()).toBe(10)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/entitlements.test.ts`
Expected: FAIL — `DEFAULT_MAX_IMAGES_PER_NOTE`/`getMaxImagesPerNote` are not exported from `./entitlements`.

- [ ] **Step 3: Implement the cache**

Replace the contents of `frontend/src/entitlements.ts` with:

```ts
// Server-granted entitlements: what this account is allowed to do. Not user
// preferences (those live in preferences.ts) — the values come from the server
// and the user cannot change them here.
import { getUsername } from './session'

// Premium entitlement. Stub until subscriptions ship — wire a real entitlement
// here later. One source of truth so callers don't hardcode `false`.
export function isPremium(): boolean {
  return false
}

// How many distinct images one note may reference. The server is the source of
// truth (getAccount() refreshes this cache); the quota itself is hand-edited in
// the Cosmos `users` container. Cached per user so the editor can enforce it
// without waiting on a request, and offline.
export const DEFAULT_MAX_IMAGES_PER_NOTE = 10

const imageLimitKey = (u: string) => `bpad.limit.images.${u}`

export function getMaxImagesPerNote(): number {
  const u = getUsername()
  if (!u) return DEFAULT_MAX_IMAGES_PER_NOTE
  // The null check has to come first: Number(null) is 0, which would read as
  // "no images allowed" for anyone who has never fetched their account.
  const raw = localStorage.getItem(imageLimitKey(u))
  if (raw === null) return DEFAULT_MAX_IMAGES_PER_NOTE
  const stored = Number(raw)
  return Number.isInteger(stored) && stored >= 0 ? stored : DEFAULT_MAX_IMAGES_PER_NOTE
}

export function setMaxImagesPerNote(limit: number): void {
  const u = getUsername()
  if (!u) return
  try {
    localStorage.setItem(imageLimitKey(u), String(limit))
  } catch {
    /* quota / private mode – best-effort, mirrors the sort preference */
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/entitlements.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the value into `getAccount()`**

In `frontend/src/authApi.ts`:

1. Extend the import from `./preferences`'s neighbour — add a new import line near the existing `import { setSortPref, type SortField } from './preferences'`:

```ts
import { setMaxImagesPerNote } from './entitlements'
```

2. Add the field to the `Account` interface, after `sortBy: SortField`:

```ts
  maxImagesPerNote: number
```

3. In `getAccount()`, next to the existing `setSortPref(account.sortBy)`:

```ts
  setMaxImagesPerNote(account.maxImagesPerNote)
```

- [ ] **Step 6: Type-check and run the whole frontend suite**

Run: `cd frontend && npm run build && npx vitest run`
Expected: build succeeds (`tsc -b` finds no missing `maxImagesPerNote`), all tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/entitlements.ts frontend/src/entitlements.test.ts frontend/src/authApi.ts
git commit -m "feat(web): cache the account's images-per-note quota"
```

---

## Task 4: The editor stops at the limit

**Files:**
- Modify: `frontend/src/Editor.tsx`
- Modify: `frontend/src/i18n/en.ts` (the `editor` block)
- Test: `frontend/src/Editor.test.tsx` (create)

**Interfaces:**
- Consumes: `getMaxImagesPerNote()` from Task 3, `parseImageIds()` from `./imageRefs`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/Editor.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// No jsdom: renderToStaticMarkup gives the markup of the first render only —
// enough for the limit, which is derived from the initial draft. Editor pulls in
// api.ts, so localStorage and window have to exist (see api.test.ts).
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage
;(globalThis as unknown as { window: unknown }).window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false }),
}

const { default: Editor } = await import('./Editor')
const { LanguageProvider } = await import('./i18n')

// Signed out, so getMaxImagesPerNote() returns the default of 10.
const draftWith = (count: number) =>
  Array.from({ length: count }, (_, i) => `![](bpad-img:img-${i})`).join('\n')

const render = (initialContent: string) =>
  renderToStaticMarkup(
    <LanguageProvider>
      <Editor submitLabel="File it" onSubmit={async () => {}} initialContent={initialContent} />
    </LanguageProvider>,
  )

// The button's markup: React renders `disabled` as a bare attribute.
const addImageButtonIsDisabled = (html: string) => {
  const match = html.match(/<button[^>]*class="capture-tab add-image-btn"[^>]*>/)
  if (!match) throw new Error('Add image button not found in:\n' + html)
  return match[0].includes('disabled')
}

describe('Editor image limit', () => {
  it('leaves "Add image" enabled below the limit', () => {
    expect(addImageButtonIsDisabled(render(draftWith(9)))).toBe(false)
  })

  it('disables "Add image" once the draft holds the maximum', () => {
    expect(addImageButtonIsDisabled(render(draftWith(10)))).toBe(true)
  })

  it('counts one repeated image once', () => {
    const repeated = Array.from({ length: 12 }, () => '![](bpad-img:same)').join('\n')
    expect(addImageButtonIsDisabled(render(repeated))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/Editor.test.tsx`
Expected: FAIL — the second test gets `false`; the button is never disabled yet.

- [ ] **Step 3: Add the translation key**

In `frontend/src/i18n/en.ts`, in the `editor` block right after `imageFailed`:

```ts
    imageLimit: 'a note can hold at most {limit} images',
```

- [ ] **Step 4: Count the draft's images in `Editor.tsx`**

Add `useMemo` to the react import on line 1:

```ts
import { useState, useEffect, useRef, useMemo } from 'react'
```

Add two imports next to the existing `import { processImage, uploadImage } from './images'`:

```ts
import { parseImageIds } from './imageRefs'
import { getMaxImagesPerNote } from './entitlements'
```

Inside the component, after the `pendingCaret` ref declaration:

```ts
  // Per-account quota, enforced here so an over-limit upload never starts; the
  // API rejects one anyway (403), which is the backstop for a stale cache.
  const imageLimit = getMaxImagesPerNote()
  const atImageLimit = useMemo(
    () => parseImageIds(draft).length >= imageLimit,
    [draft, imageLimit],
  )
```

- [ ] **Step 5: Refuse the insertion at the limit**

In `insertImageFromFile`, as the very first statement (before the caret is read) — this covers the paste path too, where a disabled button is no help:

```ts
    if (atImageLimit) {
      setError(t('editor.imageLimit', { limit: imageLimit }))
      return
    }
```

- [ ] **Step 6: Disable the "Add image" button**

In the `add-image-btn` button, change:

```tsx
          disabled={submitting || uploading}
```

to:

```tsx
          disabled={submitting || uploading || atImageLimit}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/Editor.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 8: Type-check, lint and run the whole frontend suite**

Run: `cd frontend && npm run build && npm run lint && npx vitest run`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/Editor.tsx frontend/src/Editor.test.tsx frontend/src/i18n/en.ts
git commit -m "feat(web): block image insertion once a note hits its quota"
```

---

## Task 5: Surface the server's message on update, and document the limit

**Files:**
- Modify: `frontend/src/api.ts` (`updateNote`, ~line 216)
- Modify: `frontend/src/api.test.ts` (append a describe block)
- Modify: `CLAUDE.md` (the images paragraph)

**Interfaces:**
- Consumes: the 403 body `{"error": "A note can hold at most N images."}` from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

In `frontend/src/api.test.ts`, add `updateNote` to the existing dynamic import:

```ts
const { listNotesCached, getKnownTags, createNote, updateNote } = await import('./api')
```

and append at the end of the file:

```ts
// A rejected save has to say why — the images-per-note quota returns a 403 whose
// message names the number. createNote already forwards it; updateNote used to
// replace it with a generic failure.
describe('updateNote error reporting', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('forwards the server’s error message', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'A note can hold at most 10 images.' }),
      }),
    )

    await expect(updateNote('note-1', '# body')).rejects.toThrow(
      'A note can hold at most 10 images.',
    )
  })

  it('falls back to a generic message when the body carries none', async () => {
    setSession('token', dataKey, new Uint8Array(32), 'alice')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    )

    await expect(updateNote('note-1', '# body')).rejects.toThrow(/save/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: FAIL on the first new test — the thrown message is the generic `errors.saveFailed` string, not the server's.

- [ ] **Step 3: Forward the message**

In `frontend/src/api.ts`, in `updateNote`, replace:

```ts
  if (!res.ok) throw new Error(translate('errors.saveFailed'))
```

with the same shape `createNote` already uses:

```ts
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || translate('errors.saveFailed'))
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: PASS

- [ ] **Step 5: Document the limit in `CLAUDE.md`**

In the **"Images in notes"** paragraph, append this sentence at the end:

```markdown
A note may reference at most `max_images_per_note` distinct images — a per-user quota on the Cosmos `users` document, default 10, deliberately **not** writable through any endpoint (change it by hand in Data Explorer). `auth/me` reports it as `maxImagesPerNote`, the editor blocks insertion once a draft hits it, and `notes` create/update answer 403 if the reported `image_ids` go over.
```

- [ ] **Step 6: Run every test on both sides**

Run:
```bash
cd frontend && npm run build && npm run lint && npx vitest run
cd ../api && source .venv/bin/activate && python -m pytest
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts CLAUDE.md
git commit -m "feat(web): show the server's reason when a note update is rejected"
```

---

## Manual verification (after Task 5)

The automated tests never exercise a real browser, so check the loop by hand once:

1. `cd api && source .venv/bin/activate && POW_DIFFICULTY=0 func start` (port 7071) and `cd frontend && npm run dev`.
2. Register a throwaway account, open a new note, add images one at a time. At the 10th the **"Add image"** button goes grey; pasting an 11th from the clipboard shows *"a note can hold at most 10 images"* and no upload starts (nothing new in the Network tab).
3. Without Cosmos configured the API uses in-memory repositories, so the quota is always the default 10. To see a hand-edited quota end to end, point the API at Cosmos (`COSMOS_CONNECTION_STRING`), set `max_images_per_note` to `2` on the user document in Data Explorer, reload the app (this refreshes the cache through `auth/me`) and confirm the editor stops at 2.
