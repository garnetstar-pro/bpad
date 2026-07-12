# Internationalization: English baseline + multilanguage-ready

**Date:** 2026-07-12
**Status:** Approved design

## Problem

The app's UI copy, log messages, and code comments are in Czech (per the
current CLAUDE.md convention). We want the product in **English**, and we want
the codebase **ready to add more languages** without another refactor.

This design **overrides** the existing CLAUDE.md rule ("UI copy and log
messages are in Czech"). After this work, English is the baseline for both
user-facing copy and developer-facing text (comments, logs). CLAUDE.md must be
updated to match.

## Decisions (locked during brainstorming)

1. **Mechanism:** a lightweight custom `t()` layer — no new dependency (fits
   the app's minimalism and strict CSP). Not `react-i18next`.
2. **Languages:** **English only** for now. The infrastructure supports adding
   locales (a new dictionary of the same shape), but no second language ships.
3. **Scope:** translate **everything** — user-facing copy *and* code comments
   *and* log messages — to English.
4. **Backend:** the **frontend owns UI language**. Backend user-facing strings
   (errors, verification email) are translated to English *in place*; the
   backend gets **no i18n layer**. True per-locale backend (error codes /
   `Accept-Language`) is a later phase, out of scope here.

## Goals

- All user-facing strings rendered through a `t('key')` lookup against an
  English dictionary, so adding a language is drop-in.
- English default, detected from `navigator.language`, persisted in
  `localStorage`, switchable — with the switcher UI present but hidden while
  only one locale exists.
- Backend responses and email in English.
- Entire codebase (comments, logs) in English.
- No new runtime dependency.

## Non-goals

- Shipping a second language (the infra is ready; no `cs.ts` is created).
- Backend localization by user/request locale (error codes, `Accept-Language`).
- Locale-aware number/date formatting beyond what `toLocaleDateString` already
  does (Account "joined" date may switch to the active locale later; for now it
  can use the browser default).
- Full ICU pluralization. Simple `{param}` interpolation only; the few
  count-bearing strings are phrased to read acceptably for all counts.

## Design

### 1. i18n core — `frontend/src/i18n/`

**`en.ts`** — the English dictionary: a typed, nested object grouped by area.
Example shape:

```ts
export const en = {
  common: { save: 'Save', cancel: 'Cancel', back: '← back', logOut: 'log out' },
  auth: {
    login: 'Log in',
    createAccount: 'Create account',
    solvingRobot: 'verifying you’re not a robot…',
    // …
  },
  editor: { saveHint: 'ctrl+enter or click “{label}”', saving: 'saving…' },
  verify: {
    remaining: 'Unverified account — {remaining} of {limit} notes left. Verify your e-mail to write without limits.',
    atLimit: 'You’ve hit the {limit}-note limit — verify your e-mail to keep writing.',
    // …
  },
  errors: { saveFailed: 'Saving failed', loadFailed: 'Could not load notes' /* … */ },
  // account, features, update, capture, welcome, offline, biometric …
} as const

export type Dictionary = typeof en
```

**`index.tsx`** — the runtime:

- `type Locale = 'en'` (union grows as locales are added).
- `LOCALES: Record<Locale, Dictionary>` = `{ en }`.
- `LanguageProvider`: React context holding the current `locale` in state.
  Initial locale = persisted `localStorage['bpad.locale']` if valid, else the
  first supported match of `navigator.language`, else `'en'`.
- `useTranslation()` → `{ t, locale, setLocale }`.
  - `t(key: string, params?: Record<string, string | number>): string` —
    resolves a dot-path (`'editor.saveHint'`) against the active dictionary,
    interpolates `{param}` tokens, and on a missing key returns the key itself
    (dev-visible) rather than throwing.
  - `setLocale(l)` updates state + persists to `localStorage`, triggering a
    re-render through the context.
- `availableLocales(): Locale[]` for the switcher.

Key format is dot-path strings. Type-safety of *keys* is best-effort (string
paths); type-safety of *dictionaries* is enforced — every locale must be a
`Dictionary`, so a new locale can't omit keys.

### 2. Provider wiring

`main.tsx` wraps the tree:

```tsx
<LanguageProvider>
  <BrowserRouter>
    <AuthProvider>
      <UpdatePrompt />
      <App />
    </AuthProvider>
  </BrowserRouter>
</LanguageProvider>
```

### 3. String replacement

Every user-facing string routes through `t()`:

- **Components** (JSX text, `placeholder`, `aria-label`, button labels):
  `App, AuthGate, Account, Features, Editor, Home, NoteDetail, VerifyEmail,
  BiometricUnlock, BiometricEnrollPrompt, UpdatePrompt, Capture`.
- **Frontend-generated error messages** thrown in `api.ts`, `authApi.ts`,
  `webauthn.ts` etc. These are shown to the user, so they must be translated.
  They live in plain modules (not components) where the `useTranslation()` hook
  is unavailable, so they use the **non-hook `translate(key, params?)`** export.
  `translate()` reads a module-level "active locale" variable that the
  `LanguageProvider` keeps in sync with its state on every change, and shares
  one lookup/interpolation implementation with `t()`. Modules therefore throw
  **already-localized** `Error.message` strings (e.g.
  `throw new Error(translate('errors.saveFailed'))`), and the catching component
  just displays `err.message` — no per-component mapping. (Server-surfaced
  messages are the exception below and are shown verbatim.)
- **`verifyStatus.ts`** message builders take/emit English via `translate()`.
- **Welcome note** (`welcomeNote.ts`): `welcomeNoteMarkdown(host)` returns
  English Markdown (via `translate()` or a direct English template — it is a
  single large block, so a direct English template keyed under `welcome.md`
  with `{host}` interpolation is cleanest).
- **Features page** (`Features.tsx`): the `FEATURES` array text → dictionary
  entries.

Server-surfaced errors (e.g. the soft-gate 403 body message) already flow to
the UI verbatim; since the backend is English after this change, they read
correctly without frontend mapping.

### 4. Language switcher

On the **Account page**: a small selector listing `availableLocales()`. Render
it only when `availableLocales().length > 1`, so with English-only it is hidden.
Selecting a locale calls `setLocale`. This is the visible "prepared for
multilanguage" surface.

### 5. Backend, comments, logs

- **Backend user-facing strings** — every Czech error string in
  `function_app.py` (and any other endpoint module) and the verification
  **email subject + body** in `mailer.py` → English, in place.
- **Code comments** — all Czech comments across frontend and backend → English,
  in place. Not routed through `t()`.
- **Log messages** — all Czech `logging.*` / warning strings → English, in
  place.

### 6. CLAUDE.md

Update the "Overview" language note: user-facing copy is **English via the
`t()` i18n layer**; code comments and logs are **English**. Remove the
"strings are Czech" instruction.

## Affected files

**New:**
- `frontend/src/i18n/en.ts` — English dictionary
- `frontend/src/i18n/index.tsx` — provider, `useTranslation`, `t`/`translate`
- `frontend/src/i18n/i18n.test.ts` — unit tests for lookup/interpolation/fallback

**Modified (frontend — strings → `t()`, comments → English):**
- `main.tsx`, `App.tsx`, `AuthGate.tsx`, `Account.tsx`, `Features.tsx`,
  `Editor.tsx`, `Home.tsx`, `NoteDetail.tsx`, `VerifyEmail.tsx`,
  `BiometricUnlock.tsx`, `BiometricEnrollPrompt.tsx`, `UpdatePrompt.tsx`,
  `Capture.tsx`, `verifyStatus.ts`, `welcomeNote.ts`, `api.ts`, `authApi.ts`,
  `webauthn.ts`, `biometric.ts`, `device.ts`, `session.ts`, `markdown.tsx`,
  and any remaining module with Czech comments.
- Test updates: `welcomeNote.test.ts`, `verifyStatus.test.ts` (assert English).

**Modified (backend — strings/comments/logs → English):**
- `function_app.py`, `mailer.py`, `auth.py`, `pow.py`, `repository.py`,
  `ratelimit.py`, `models.py`, and test files if any assert Czech.

**Docs:**
- `CLAUDE.md` — language convention updated.

## Testing

- **`i18n.test.ts`:** `t()` resolves a nested key; interpolates `{param}`;
  returns the key on a miss; `translate()` (non-hook) matches `t()`.
- **`verifyStatus.test.ts` / `welcomeNote.test.ts`:** updated to assert the new
  English output.
- **Frontend:** `npx vitest run` all green; `npm run build` (tsc + vite) clean;
  `npm run lint` clean.
- **Backend:** `pytest -q` green (update any test asserting a Czech string).
- **Manual:** register a new account → welcome note is English; verify banner,
  editor hints, account/features pages read English; a forced 403 (11th note)
  shows the English server message.

## Rollout / phasing (for the plan)

1. i18n core + tests (`en.ts`, `index.tsx`, `i18n.test.ts`), provider wired.
2. Frontend components → `t()`, in reviewable batches (auth/account/features;
   editor/home/notes; banners/prompts/capture; welcome note).
3. Frontend non-component strings (`api.ts`, `authApi.ts`, `webauthn.ts`,
   `verifyStatus.ts`) via `translate()`; update `verifyStatus`/`welcomeNote`
   tests.
4. Backend strings + email → English; `pytest` green.
5. Comments + logs → English (frontend + backend) — mechanical sweep.
6. Language switcher on Account page (hidden while single-locale).
7. CLAUDE.md update.

## Future enhancements (out of scope)

- Add a real second locale (`cs.ts`, etc.) — validates the switcher end-to-end.
- Backend localization via error codes + `Accept-Language`.
- ICU pluralization / locale-aware number & date formatting.
