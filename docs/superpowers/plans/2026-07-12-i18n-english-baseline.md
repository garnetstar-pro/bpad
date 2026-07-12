# English i18n Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all user-facing copy behind a lightweight custom `t()` i18n layer with an English dictionary, translate the whole codebase (copy, comments, logs) to English, and make adding a language drop-in.

**Architecture:** A dependency-free i18n core (`frontend/src/i18n/`) exposes a `LanguageProvider`, a `useTranslation()` hook returning `t()`, and a non-hook `translate()` for plain modules — both reading one English dictionary (`en.ts`) via dot-path keys with `{param}` interpolation. Components and modules replace inline Czech strings with `t()`/`translate()` calls; backend strings, all comments, and all logs are translated to English in place (no backend i18n layer).

**Tech Stack:** React 19 / Vite / TypeScript (frontend), Python 3.12 / Azure Functions (backend). **No new dependency.**

## Global Constraints

- **No new frontend or backend dependency.** Custom `t()` only.
- **English only** ships. `type Locale = 'en'`; `LOCALES = { en }`. Structure must let a second dictionary be added without touching call sites.
- Persisted locale key: `localStorage['bpad.locale']`. Default: first supported match of `navigator.language`, else `'en'`.
- Missing translation key → `t()`/`translate()` return the **key string itself** (never throw).
- Interpolation tokens are `{name}` (e.g. `{count}`, `{host}`, `{label}`). Simple string replace; no ICU/plurals — count-bearing English is phrased to read for all counts.
- Server-surfaced error messages are shown **verbatim** (backend is English after Task 7); the frontend does not map them.
- Every commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- After each task: `cd frontend && npx vitest run && npm run build && npm run lint` must be green (frontend tasks); `cd api && source .venv/bin/activate && python -m pytest -q` green (backend tasks). The pre-existing `AuthContext.tsx` oxlint `only-export-components` warning is expected and not introduced here.

## Key-Naming Convention

Dot-path, `area.name`. Areas: `common`, `auth`, `editor`, `home`, `notes`, `account`, `features`, `verify`, `update`, `capture`, `welcome`, `offline`, `biometric`, `errors`. Each task **adds its area's keys to `en.ts`** with the English translation (translate the file's actual Czech faithfully; keep meaning and tone). Reuse `common.*` for shared labels (`save`, `cancel`, `back`, `logOut`, `loading`).

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/i18n/en.ts` *(new)* | English dictionary + `Dictionary` type |
| `frontend/src/i18n/index.tsx` *(new)* | `LanguageProvider`, `useTranslation`, `t`, `translate`, `setLocale`, `availableLocales` |
| `frontend/src/i18n/i18n.test.ts` *(new)* | unit tests for lookup / interpolation / fallback / translate-parity |
| `frontend/src/*` *(modified)* | inline strings → `t()`/`translate()`; comments → English |
| `api/*.py` *(modified)* | strings/email → English; comments/logs → English |
| `CLAUDE.md` *(modified)* | language convention updated |

---

## Task 1: i18n core + provider

**Files:**
- Create: `frontend/src/i18n/en.ts`
- Create: `frontend/src/i18n/index.tsx`
- Create: `frontend/src/i18n/i18n.test.ts`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces:
  - `en: Dictionary`, `type Dictionary = typeof en`
  - `LanguageProvider({ children }): JSX.Element`
  - `useTranslation(): { t: (key: string, params?: Params) => string; locale: Locale; setLocale: (l: Locale) => void }`
  - `translate(key: string, params?: Params): string` (non-hook)
  - `availableLocales(): Locale[]`
  - `type Locale = 'en'`, `type Params = Record<string, string | number>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/i18n/i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { translate, setActiveLocale } from './index'

describe('translate', () => {
  it('resolves a nested dot-path key', () => {
    expect(translate('common.save')).toBe('Save')
  })

  it('interpolates {params}', () => {
    // editor.saveHint = 'ctrl+enter or click “{label}”'
    expect(translate('editor.saveHint', { label: 'File it' })).toBe(
      'ctrl+enter or click “File it”',
    )
  })

  it('returns the key itself when missing', () => {
    expect(translate('does.not.exist')).toBe('does.not.exist')
  })

  it('follows the active locale set via setActiveLocale', () => {
    setActiveLocale('en')
    expect(translate('common.cancel')).toBe('Cancel')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/i18n/i18n.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write `frontend/src/i18n/en.ts`**

Start the dictionary with `common` plus the two keys the tests reference. Later tasks append their areas.

```ts
// English translations. Adding a language = a sibling dictionary of the same
// shape (Dictionary), registered in index.tsx LOCALES.
export const en = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    back: '← back',
    logOut: 'log out',
    loading: 'loading…',
  },
  editor: {
    saveHint: 'ctrl+enter or click “{label}”',
  },
} as const

export type Dictionary = typeof en
```

- [ ] **Step 4: Write `frontend/src/i18n/index.tsx`**

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { en, type Dictionary } from './en'

export type Locale = 'en'
export type Params = Record<string, string | number>

const LOCALES: Record<Locale, Dictionary> = { en }
const STORAGE_KEY = 'bpad.locale'

export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[]
}

function isLocale(v: string | null): v is Locale {
  return v !== null && v in LOCALES
}

function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (isLocale(stored)) return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en'
  return isLocale(nav) ? nav : 'en'
}

// Modul-level aktivní locale pro non-hook translate() (moduly bez Reactu).
let activeLocale: Locale = 'en'
export function setActiveLocale(l: Locale): void {
  activeLocale = l
}

function lookup(dict: Dictionary, key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}

function resolve(locale: Locale, key: string, params?: Params): string {
  const s = lookup(LOCALES[locale], key)
  return s === undefined ? key : interpolate(s, params)
}

// Non-hook překlad pro plain moduly (api.ts, authApi.ts, …).
export function translate(key: string, params?: Params): string {
  return resolve(activeLocale, key, params)
}

interface Ctx {
  t: (key: string, params?: Params) => string
  locale: Locale
  setLocale: (l: Locale) => void
}
const LanguageContext = createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const l = detectLocale()
    setActiveLocale(l)
    return l
  })

  const value = useMemo<Ctx>(
    () => ({
      locale,
      t: (key, params) => resolve(locale, key, params),
      setLocale: (l) => {
        setActiveLocale(l)
        try {
          localStorage.setItem(STORAGE_KEY, l)
        } catch {
          // localStorage nedostupný – jen držíme v paměti
        }
        setLocaleState(l)
      },
    }),
    [locale],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useTranslation(): Ctx {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useTranslation must be used within LanguageProvider')
  return ctx
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/i18n/i18n.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire the provider in `main.tsx`**

Add the import and wrap the tree (outermost):

```tsx
import { LanguageProvider } from './i18n'
// …
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <BrowserRouter>
        <AuthProvider>
          <UpdatePrompt />
          <App />
        </AuthProvider>
      </BrowserRouter>
    </LanguageProvider>
  </StrictMode>,
)
```

- [ ] **Step 7: Build, lint, full test**

Run: `cd frontend && npx vitest run && npm run build && npm run lint`
Expected: all green (only the known `AuthContext.tsx` warning).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/i18n frontend/src/main.tsx
git commit -m "$(cat <<'EOF'
Add dependency-free i18n core (English)

LanguageProvider + useTranslation()/t() for components and a non-hook
translate() for plain modules, both over an English dictionary with
dot-path keys and {param} interpolation. English-only; adding a locale is
a drop-in dictionary. Missing keys return the key. Provider wired in main.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Conversion tasks (2–5): shared method

For every user-facing string in the task's files:

1. Add a key under the file's area in `en.ts` with the **English** translation of the current Czech string (translate faithfully; keep tone, punctuation, and any emoji).
2. In a **component**, replace the inline string with `t('area.key')` (add `const { t } = useTranslation()` at the top of the component). For interpolated strings pass params: `t('verify.remaining', { remaining, limit })`.
3. In a **plain module** (no component), use `translate('area.key', params)`.
4. Translate every Czech **comment** in the touched file to English.
5. `aria-label`, `placeholder`, `title` attributes count as user-facing — convert them too.

Do **not** change behavior, class names, or control flow — only string sourcing and comments. After each task run the frontend gate (vitest + build + lint).

---

## Task 2: Auth, Account, Features components

**Files:** Modify `frontend/src/AuthGate.tsx`, `frontend/src/Account.tsx`, `frontend/src/Features.tsx`; append `auth`, `account`, `features` areas to `frontend/src/i18n/en.ts`.

**Interfaces:** Consumes `useTranslation` from Task 1.

- [ ] **Step 1: Add the `auth`/`account`/`features` keys to `en.ts`**

Translate each current Czech string in those three files. Representative required keys (add all that appear; these are the non-obvious ones — translate the rest 1:1):

```ts
auth: {
  login: 'Log in',
  loginSub: 'Unlock your encrypted vault.',
  createAccount: 'Create account',
  createSub: 'Create your private encrypted vault.',
  username: 'username',
  password: 'password',
  passwordAgain: 'password again',
  email: 'e-mail',
  emailPlaceholder: 'for verification and alerts',
  strongPassword: 'choose a strong password',
  repeatPassword: 'repeat the password',
  unlocking: 'unlocking…',
  creatingVault: 'creating vault…',
  solvingRobot: 'verifying you’re not a robot…',
  forgotPassword: 'Forgot password?',
  toRegister: 'Create account →',
  backToLogin: '← Back to login',
  loginHint: 'The key is derived in your browser and lives only in memory. Closing the tab logs you out.',
  registerHint: 'The password can’t be recovered from the server. After signup you get a recovery code — save it.',
  recoveryTitle: 'Your recovery code',
  recoveryWarn: '⚠ Write it down now. It’s shown only once. Without your password and this code, the notes are lost for good.',
  recoverySaved: 'I’ve saved the code safely',
  toVault: 'Continue to the vault',
  copy: 'Copy', download: 'Download .txt',
  recoverTitle: 'Reset password', recoverSub: 'Enter your recovery code and set a new password.',
  recoveryCode: 'recovery code', newPassword: 'new password',
  recovering: 'recovering…', recoverSubmit: 'Reset and log in',
  recoverHint: 'The code unlocks the vault in your browser and re-wraps it with the new password. Notes are not re-encrypted.',
  errEmail: 'Enter a valid e-mail', errPwLen: 'Password must be at least 8 characters',
  errPwMatch: 'Passwords don’t match', errRegister: 'Registration failed',
  errLogin: 'Login failed', errRecover: 'Recovery failed', errNewPwLen: 'New password must be at least 8 characters',
  metaAccess: 'access: you only', metaNewVault: 'new vault', metaSave: 'save this', metaRecover: 'recover',
  brandKicker: 'blank pad · encrypted',
},
account: {
  title: 'Account', username: 'username', email: 'e-mail', notes: 'notes',
  joined: 'joined', verified: 'verified ✓', unverified: 'unverified',
  emailOffline: 'Your e-mail loads once you’re online.',
  verifyCta: 'Verify your e-mail to write without limits.',
  sendLink: 'Send verification link', sent: 'Sent ✓', sendFailed: 'Failed, try again',
  whatCanDo: 'What bpad can do →',
},
features: {
  title: 'What bpad can do',
  // one {name}/{desc} pair per feature — see Task’s file for the list
},
```

Full **Features** list (English), replacing the `FEATURES` array text:

```
Encrypted vault — Everything is encrypted in your browser (zero-knowledge). The server never sees your notes — neither do we.
Markdown with auto-title — Write in Markdown; the first "# …" heading becomes the note title. You can also override it.
Preview — Toggle between writing and a rendered Markdown preview right in the editor.
Quick save — Ctrl+Enter (Cmd+Enter on Mac) saves from anywhere in the editor.
Smart search — Full-text over the list that ignores diacritics — "clanek" finds "Článek".
Per-note URLs — Every note has its own address (/notes/…), so you can link and return to it.
Save a link in one move — Type "this-domain/" then a full URL and it becomes a new note.
Biometric unlock — On devices with biometrics, unlock the vault with a fingerprint or face — no password typing.
Offline & installable — Read your notes with no signal, and install bpad to your home screen as a standalone app (PWA).
Recovery code — At signup you get a one-time code to regain access if you forget your password. Save it.
E-mail verification — Unverified accounts have a note cap; after verifying your e-mail you write without limits.
```

- [ ] **Step 2: Convert `AuthGate.tsx`, `Account.tsx`, `Features.tsx`**

Add `const { t } = useTranslation()` inside each component that renders strings (note `AuthGate` has several sub-components — add the hook in each: `LoginForm`, `RegisterForm`, `RecoveryCodeScreen`, `RecoverForm`, and `Shell` receives `meta` already as a prop, keep passing translated values). Replace every inline Czech string with the matching `t('…')`. Convert placeholders/labels. Translate comments to English.

For `Features.tsx`, key the array as `{ nameKey, descKey }` or map indices to `t('features.item0.name')` — simplest: keep the array but store English text via `t()`; since the list is static English content, define `features.list` as an array in `en.ts` is not allowed by the flat-string dictionary, so instead add `features.f1name`, `features.f1desc`, … `features.f11name/desc` and render them, OR keep the English text directly in `Features.tsx` (it is display copy, English-only). **Chosen:** keep the `FEATURES` array in `Features.tsx` with the English text inline (it is content, not reused), and only route the page title through `t('features.title')`. Translate its comments.

- [ ] **Step 3: Frontend gate**

Run: `cd frontend && npx vitest run && npm run build && npm run lint`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/AuthGate.tsx frontend/src/Account.tsx frontend/src/Features.tsx frontend/src/i18n/en.ts
git commit -m "$(cat <<'EOF'
i18n: translate auth, account and features screens to English

Route auth/account screen copy through t(); Features page content is
English. Comments in these files translated.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Editor, Home, NoteDetail

**Files:** Modify `frontend/src/Editor.tsx`, `frontend/src/Home.tsx`, `frontend/src/NoteDetail.tsx`; append `editor`, `home`, `notes` areas to `en.ts`.

- [ ] **Step 1: Add keys to `en.ts`**

Translate the strings in these files. Known ones:

```ts
editor: {
  saveHint: 'ctrl+enter or click “{label}”', // already added in Task 1
  saving: 'saving…',
  title: 'title',
  titlePlaceholder: 'derived from the markdown when left empty',
  write: 'Write', preview: 'Preview',
  bodyPlaceholder: 'Write a thought or paste a link…',
  nothingToPreview: 'nothing to preview',
  fileIt: 'File it',
  saveFailed: 'Saving failed. Try again.', // fallback only; server msg shown verbatim
},
home: {
  connectFailed: 'Couldn’t reach the backend. Is func start running?',
  recentEntries: 'recent entries',
  searchPlaceholder: 'search notes…',
  clearSearch: 'Clear search',
  loading: 'loading…', noEntries: 'no entries yet', nothingFound: 'nothing found',
},
notes: {
  save: 'Save', saveHintCtrl: 'ctrl+enter saves',
  edit: 'Edit', delete: 'Delete', deleteConfirm: 'Delete this note?',
  deleteFailed: 'Delete failed. Try again.', notFound: 'Note not found',
  back: '← back to list', edited: 'edited',
},
```

- [ ] **Step 2: Convert the three files**

Add `const { t } = useTranslation()` in each component; replace strings; the `Editor` `submitLabel` prop stays a string but callers pass `t('editor.fileIt')` / `t('notes.save')`. In `Editor`, the error `catch` keeps showing `err.message` (server/localized) and only the generic fallback becomes `t('editor.saveFailed')`. Translate comments.

- [ ] **Step 3: Frontend gate** — `npx vitest run && npm run build && npm run lint` green.

- [ ] **Step 4: Commit** (`git add` the three files + `en.ts`), message `i18n: translate editor, home and note detail`.

---

## Task 4: App shell, banners, prompts, capture, biometric, verify-email

**Files:** Modify `frontend/src/App.tsx`, `frontend/src/UpdatePrompt.tsx`, `frontend/src/Capture.tsx`, `frontend/src/VerifyEmail.tsx`, `frontend/src/BiometricUnlock.tsx`, `frontend/src/BiometricEnrollPrompt.tsx`; append `verify`, `update`, `capture`, `offline`, `biometric` areas to `en.ts`.

- [ ] **Step 1: Add keys to `en.ts`**

```ts
offline: { banner: 'Offline · read-only — changes can’t be saved' },
verify: {
  remaining: 'Unverified account — {remaining} of {limit} notes left. Verify your e-mail to write without limits.',
  atLimit: 'You’ve hit the {limit}-note limit — verify your e-mail to keep writing.',
  sent: 'Sent ✓ — check your inbox',
  sendLink: 'Send verification link', sendFailed: 'Failed, try again',
  softGate: 'Verify your e-mail for more than {limit} notes.', // mirror of backend message (see Task 7)
},
update: {
  available: 'A new version of bpad is available.',
  refresh: 'Update', dismiss: 'Close',
},
capture: { saving: 'saving link…', failed: 'Saving the link failed', home: '← home' },
biometric: {
  // translate BiometricUnlock.tsx / BiometricEnrollPrompt.tsx copy here
},
```

`verifyStatus.ts` (Task 5) owns the actual `remaining`/`atLimit` builders; App passes the computed `noteCount` — keep `verifyBannerMessage` producing the string but sourced from `translate('verify.remaining', …)`.

- [ ] **Step 2: Convert the files**

`App.tsx`: add `const { t } = useTranslation()`; offline banner, verify banner button labels, `log out`, `odemykat otiskem` → `t()`. The verify banner text comes from `verifyBannerMessage(noteCount)` (updated in Task 5). Header brand strings (`blank pad · encrypted`) → `t('auth.brandKicker')`. `UpdatePrompt`, `Capture`, `VerifyEmail`, `BiometricUnlock`, `BiometricEnrollPrompt`: convert all copy, translate comments. Read each file to enumerate its exact strings and add matching keys.

- [ ] **Step 3: Frontend gate** — green.

- [ ] **Step 4: Commit** — message `i18n: translate app shell, banners, prompts and biometric flows`.

---

## Task 5: Plain modules + welcome note + test updates

**Files:** Modify `frontend/src/api.ts`, `frontend/src/authApi.ts`, `frontend/src/webauthn.ts`, `frontend/src/verifyStatus.ts`, `frontend/src/welcomeNote.ts`; update `frontend/src/verifyStatus.test.ts`, `frontend/src/welcomeNote.test.ts`; append `errors`, `welcome` areas + finalize `verify` in `en.ts`.

- [ ] **Step 1: Add keys**

```ts
errors: {
  vaultLocked: 'Vault is locked', offlineWrite: 'You’re offline — changes can’t be saved',
  loadFailed: 'Could not load notes', offlineNoNotes: 'Offline with no saved notes',
  noteNotFound: 'Note not found', noteNotOffline: 'Note isn’t available offline',
  saveFailed: 'Saving failed', deleteFailed: 'Delete failed',
  sessionExpired: 'Session expired', loginFailed: 'Login failed',
  wrongUserOrPass: 'Wrong username or password', registerFailed: 'Registration failed',
  emailTaken: 'Username or e-mail is taken', invalidEmail: 'Invalid e-mail or details',
  sendFailed: 'Sending failed', linkInvalid: 'The link is invalid or expired',
  userNotFound: 'User not found', invalidRecovery: 'Invalid recovery code',
  recoverFailed: 'Recovery failed', offlineNoUser: 'You’re offline and I have no saved data for this user.',
  savedLoginInvalid: 'Your saved login is no longer valid', accountLoadFailed: 'Could not load the account',
},
verify: { /* remaining/atLimit already added in Task 4 */ },
welcome: {
  md: `# 👋 Welcome to bpad

This is your first note — edit or delete it freely. **bpad** is an encrypted notebook: only you see the content; the server never does.

## Try it
- **Markdown** — the first \`# …\` heading becomes the note title. Toggle **Preview** above.
- **Quick save** — \`Ctrl+Enter\` (Mac \`Cmd+Enter\`) saves from anywhere in the editor.
- **Search** — above the list; ignores diacritics (\`clanek\` finds "Článek").
- **Links** open in a new tab: [bpad.pro](https://bpad.pro)
- **Checklist**:
  - [x] Create an account
  - [ ] Save your recovery code
  - [ ] Install bpad as an app

## Save a link in one move
Type \`{host}/\` in the address bar and a full URL right after it:

\`{host}/https://example.com\`

…and it becomes a new note.

## Privacy
- Your password and keys **never leave the browser**. Without your password and recovery code, no one — not even us — can read the content.
- Turn on **biometric unlock** if your device supports it.
- Works **offline** (reading) and installs as an app.

Find the full feature list in **Account → What bpad can do**.
`,
},
```

- [ ] **Step 2: Convert modules**

In `api.ts`, `authApi.ts`, `webauthn.ts`: replace each thrown Czech `Error('…')` message with `new Error(translate('errors.…'))`; translate comments. In `verifyStatus.ts`: `verifyBannerMessage(count, limit)` returns `translate('verify.atLimit', { limit })` when 0 remaining else `translate('verify.remaining', { remaining, limit })`; `UNVERIFIED_NOTE_LIMIT` unchanged. In `welcomeNote.ts`: `welcomeNoteMarkdown(host)` returns `translate('welcome.md', { host })`.

- [ ] **Step 3: Update the two tests**

`verifyStatus.test.ts`: assert English — `verifyBannerMessage(7)` contains `'3 of 10'`; `verifyBannerMessage(10)` contains `'10-note limit'` and not `'left'`. `welcomeNote.test.ts`: `welcomeNoteMarkdown('dev.bpad.pro')` starts with `'# '`, contains `'dev.bpad.pro/https://example.com'`, and contains `'What bpad can do'`.

Note: these modules call `translate()` which reads the module-level `activeLocale` (defaults `'en'`), so tests work without a provider.

- [ ] **Step 4: Frontend gate** — `npx vitest run && npm run build && npm run lint` green.

- [ ] **Step 5: Commit** — message `i18n: translate error messages, welcome note and status builders`.

---

## Task 6: Frontend comment sweep

**Files:** Translate remaining Czech **comments** to English in every frontend file not already covered: `crypto.ts`, `offlineCache.ts`, `session.ts`, `biometric.ts`, `device.ts`, `pow.ts`, `powWorker.ts`, `captureUrl.ts`, `search.ts`, `titles.ts`, `noteContent.ts`, `markdown.tsx`, `AuthContext.tsx`, and any leftover comment in earlier-touched files.

- [ ] **Step 1:** Grep for remaining Czech: `grep -rlE "[ěščřžýáíéúůňťďó]" frontend/src --include=*.ts --include=*.tsx | grep -v test`. For each file, translate comments only (no code/behavior changes). Confirm none are user-facing strings that were missed — if a user-facing string surfaces, route it through `t()`/`translate()` per the shared method and add a key.
- [ ] **Step 2:** `cd frontend && npx vitest run && npm run build && npm run lint` green; then re-run the grep — only test files / intentional Czech-in-content (e.g. the search test’s "Článek", welcome note’s "Článek" example) may remain; note them.
- [ ] **Step 3: Commit** — `git add frontend/src`, message `i18n: translate remaining frontend comments to English`.

---

## Task 7: Backend strings + verification email

**Files:** Modify `api/function_app.py`, `api/mailer.py`; update any backend test asserting a Czech string.

- [ ] **Step 1: Translate every user-facing string** in `function_app.py` to English, keeping meaning:
  - `"Chybí uživatelské jméno"` → `"Missing username"`
  - `"Neplatný e-mail"` → `"Invalid e-mail"`
  - `"E-mail je už registrovaný"` → `"That e-mail is already registered"`
  - `"Uživatelské jméno je obsazené"` → `"That username is taken"`
  - `"Ověření proti robotům selhalo, zkus registraci znovu."` → `"Anti-bot check failed, please try registering again."`
  - `"Špatné jméno nebo heslo"` → `"Wrong username or password"`
  - `"Nepřihlášeno"` → `"Not signed in"`
  - `"Neplatná data: {e}"` → `"Invalid data: {e}"`
  - `"Příliš mnoho pokusů, zkus to za chvíli"` → `"Too many attempts, try again shortly"`
  - `"Ověř svůj e-mail pro víc než {n} poznámek."` → `"Verify your e-mail for more than {n} notes."` (must match `verify.softGate` from Task 4)
  - `"Poznámka nenalezena"` → `"Note not found"`, `"Uživatel nenalezen"` → `"User not found"`
  - `"Odkaz je neplatný nebo vypršel"` → `"The link is invalid or expired"`, `"Neplatný odkaz"` → `"Invalid link"`
  - `"Není co ověřovat"` → `"Nothing to verify"`, `"Neplatný recovery kód"` → `"Invalid recovery code"`
  - Translate any other Czech string literal returned via `_error`/`_json` found by reading the file.
- [ ] **Step 2: Translate the verification email** in `mailer.py` — subject and body → English, keeping the `{link}` (or equivalent) interpolation and any HTML.
- [ ] **Step 3: Check backend tests** — `grep -rlE "[ěščřžýáíéúůňťďó]" api/test_*.py`. If any assert a Czech message, update the assertion to the English text. (Most tests assert logic, not copy.)
- [ ] **Step 4: Backend gate** — `cd api && source .venv/bin/activate && python -m pytest -q` green.
- [ ] **Step 5: Live check** — start `POW_DIFFICULTY=0 func start`, force the soft-gate (register + 11 notes) and confirm the 403 body is the English message matching `verify.softGate`; confirm the logged verification link/email text is English.
- [ ] **Step 6: Commit** — `git add api/function_app.py api/mailer.py` (+ tests if changed), message `i18n: translate backend responses and verification e-mail to English`.

---

## Task 8: Backend comment + log sweep

**Files:** Translate Czech **comments** and **log messages** to English across `api/*.py`: `function_app.py`, `mailer.py`, `auth.py`, `pow.py`, `repository.py`, `ratelimit.py`, `models.py`, `conftest.py`.

- [ ] **Step 1:** For each file, translate comments and `logging.*` strings to English. No behavior changes.
- [ ] **Step 2:** `python -m pytest -q` green; re-run `grep -rlE "[ěščřžýáíéúůňťďó]" api/*.py` — only intentional content should remain (ideally none outside tests).
- [ ] **Step 3: Commit** — `git add api`, message `i18n: translate backend comments and logs to English`.

---

## Task 9: Language switcher + CLAUDE.md

**Files:** Modify `frontend/src/Account.tsx` (switcher), `CLAUDE.md`.

- [ ] **Step 1: Add the switcher to `Account.tsx`**

Using `useTranslation()` + `availableLocales()`, render a selector only when more than one locale exists:

```tsx
const { locale, setLocale } = useTranslation()
// …
{availableLocales().length > 1 && (
  <div className="account-row">
    <span className="account-key">{t('account.language')}</span>
    <select
      className="account-val"
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
    >
      {availableLocales().map((l) => (
        <option key={l} value={l}>{l.toUpperCase()}</option>
      ))}
    </select>
  </div>
)}
```

Add `account.language: 'language'` to `en.ts` and import `availableLocales`, `type Locale`. With English-only the block renders nothing (verifies it’s wired without showing an empty control).

- [ ] **Step 2: Update `CLAUDE.md`**

Replace the language note in the Overview: user-facing copy is **English via the `t()` i18n layer** (`frontend/src/i18n/`); code comments and logs are **English**; adding a language means adding a dictionary in `frontend/src/i18n/`. Remove the "strings are in Czech" instruction.

- [ ] **Step 3: Frontend gate** — `npx vitest run && npm run build && npm run lint` green.

- [ ] **Step 4: Final grep** — `grep -rnE "[ěščřžýáíéúůňťďó]" frontend/src api --include=*.ts --include=*.tsx --include=*.py | grep -v test` should be empty (or only deliberate in-content Czech like the search/welcome "Článek" example, which are noted).

- [ ] **Step 5: Commit** — `git add frontend/src/Account.tsx frontend/src/i18n/en.ts CLAUDE.md`, message `i18n: add language switcher (hidden while single-locale) and update CLAUDE.md`.

---

## Self-Review notes (for the executor)

- The dictionary is authored incrementally: each conversion task adds its area to `en.ts`. If a task finds a user-facing string with no key yet, it adds one under the right area — never leave a Czech user-facing string.
- Keys referenced across tasks (`editor.saveHint`, `verify.remaining`, `verify.atLimit`, `verify.softGate`, `welcome.md`, `auth.brandKicker`) must keep identical names to how earlier tasks defined them.
- The one backend/frontend copy that must stay in sync: the soft-gate message (`verify.softGate` ⇄ `function_app.py` note-limit 403). Both use "…for more than {n}/{limit} notes."
