# Note list sorting — design

**Date:** 2026-07-13
**Status:** Approved, ready for planning

## Goal

Let the user choose how the note list on Home is ordered: by **creation date** (default)
or by **last modification**. The sort **direction is hardcoded to newest-first**; only the
sort **field** is user-selectable. The chosen field is a **per-user preference persisted on
the server**, so it follows the user across devices.

Non-goals (YAGNI): user-configurable sort direction, additional sort fields, secondary
sort keys, sorting inside search results by relevance.

## Key facts about the current code

- `Note` (`api/models.py`) has only `created_at`. There is **no modification timestamp**.
- `update_note` (`api/function_app.py:371`) rewrites `iv`/`ct` only; it never touches a timestamp.
- The repository sorts newest-first by `created_at` (`api/repository.py:17` `_newest_first`).
- The client decrypts **all** notes and filters them in the browser (`Home.tsx` →
  `filterNotes` + `filterByTags`). No sorting happens client-side today; the list keeps the
  server's created-desc order.
- `User` carries non-secret metadata (e.g. `email`); `save_user` is an upsert.
- `auth/me` returns the profile; `getAccount()` (`frontend/src/authApi.ts:39`) consumes it.

## Architectural decision: sort runs client-side

The client already fetches, decrypts, and filters the full note set in `Home.tsx`. Applying
the final field sort there keeps the hardcoded direction in one place and requires **no sort
logic in the API**. The server keeps returning created-desc; the client re-orders by the
selected field. (Rejected alternative: a `GET /api/notes?sort=` param — buys nothing when the
client already holds and filters every note, and splits the logic across tiers.)

## Design

### 1. Backend — modification timestamp

- **`api/models.py`**: add `updated_at: Optional[datetime] = None` to `Note`. Optional so
  existing stored notes (which lack the field) load cleanly; consumers fall back to
  `created_at` when it is null. No data migration.
- **`api/function_app.py`**:
  - `create_note` → set `updated_at = created_at` so a brand-new note sorts identically under
    both modes.
  - `update_note` → set `note.updated_at = datetime.utcnow()` before `save_note`.
  - Both handlers already return `note.model_dump(mode="json")`, so `updated_at` is emitted
    automatically.

### 2. Backend — per-user sort preference (persisted)

- **`api/models.py`**: add `sort_by: str = "created"` to `User` (non-secret metadata).
  Allowed values: `"created"` | `"modified"`.
- **`auth/me`**: add `"sortBy": user.sort_by` to the response payload.
- **New route `PUT /api/auth/preferences`**:
  - Body `{ "sortBy": "created" | "modified" }`, validated by a new `PreferencesRequest`
    Pydantic model that rejects unknown values (return 400 on invalid).
  - Requires an authenticated user (`_require_user`); loads the user, sets `sort_by`, calls
    `save_user`, returns 200. The server is the source of truth.

### 3. Frontend — carry the timestamp through

- **`frontend/src/types.ts`**: `Note` gains `updated_at: string`.
- **`frontend/src/api.ts` `decrypt`**: `updated_at: enc.updated_at ?? enc.created_at`
  (legacy fallback for notes stored before this change).
- **`frontend/src/offlineCache.ts` `EncryptedNote`**: add `updated_at?: string` so cached /
  offline-read notes carry the timestamp too.

### 4. Frontend — preference + control

- **`frontend/src/authApi.ts`**:
  - `Account` gains `sortBy: SortField` where `type SortField = 'created' | 'modified'`.
  - Add `savePreferences(sortBy: SortField): Promise<void>` → `PUT auth/preferences`.
- **Preference cache**: cache `sortBy` in `localStorage` per user (mirrors the existing
  session / `knownTags` caching style), seeded from `getAccount()` / `me`. This makes the
  preference available to `Home` without an extra fetch and works offline (read-only).
  Provide `getSortPref()` (defaults to `'created'`) and `setSortPref(field)` helpers.
- **`frontend/src/Home.tsx`**:
  - Read `sortBy` into component state (initialized from the cache).
  - After `filterByTags(filterNotes(notes, query), ...)`, apply a **stable descending** sort
    by the chosen field: compare `updated_at` when `sortBy === 'modified'`, else `created_at`.
  - Add a small segmented control in the existing `.section-head` (next to
    "Recent entries"): **Created / Modified**. Selecting an option updates local state + the
    cache immediately (optimistic) and calls `savePreferences()`. If the server save fails
    (e.g. offline), the local change stays; it re-syncs on the next successful save. Direction
    remains hardcoded newest-first.
- **i18n (`frontend/src/i18n/en.ts`)**: add `home.sortCreated`, `home.sortModified`, and an
  `aria-label` string for the control. No hardcoded user-facing strings in components.

### 5. Tests

Follow the existing `api/test_repository.py` patterns:

- `update_note` bumps `updated_at` to a later time than `created_at`.
- `create_note` sets `updated_at == created_at`.
- Sort preference round-trips through `save_user` / `get_user`.
- `PreferencesRequest` rejects an invalid `sortBy` value.

## Notes / accepted trade-offs

- **Legacy notes** have no `updated_at` until first edited; under "Modified" they sort by
  their `created_at` (via the fallback). Expected; no migration.
- **Direction is hardcoded** newest-first; only the field is selectable — matches
  "nejnovější vždy nahoře, to bude zatím natvrdo".
- **Offline preference change** applies locally and best-effort syncs to the server; it is
  not queued for guaranteed delivery (out of scope for v1).
