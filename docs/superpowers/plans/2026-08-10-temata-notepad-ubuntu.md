# Themes (Notepad + Ubuntu console) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give bpad a switchable visual theme, shipping two new looks — classic Windows Notepad and the Ubuntu GNOME Terminal — on top of a tokenised stylesheet that makes a third theme cheap.

**Architecture:** All visual values move out of component rules into CSS custom properties declared once in `themes/contract.css`. Each theme is a file that redefines those values under `:root[data-theme="<id>"]`, plus a small number of theme-scoped structural rules. A registry in TypeScript lists the themes; a device-local preference picks one and stamps `data-theme` on `<html>` before React renders. Two automated guards keep it honest: one rejects literal colours and radii in `App.css`, the other rejects any theme file whose token set differs from the contract.

**Tech Stack:** React 19 + Vite 8, plain CSS (no preprocessor, no CSS-in-JS), vitest 4 running in plain Node (no jsdom), oxlint.

## Global Constraints

- Branch is `new-designs`, based on `origin/dev`. All line numbers below were measured on that base.
- User-facing copy is English and goes through `t()` (`frontend/src/i18n/en.ts`). Never hardcode a user-facing string in a component.
- Code comments and commit messages are English.
- Tests live beside sources as `*.test.ts`. There is **no jsdom**: a test that touches `document` or `localStorage` must stub the global itself. Do not add a DOM environment.
- Run `npm run test`, `npm run lint` and `npm run build` from `frontend/`.
- Never introduce a literal colour, `border-radius` or font-family into `App.css` again — that is what the guard in Task 1/2 enforces.
- Tasks 1–3 must produce **no visible change** to the app apart from the seven pixel/alpha normalisations explicitly listed in Tasks 1 and 2.

## Correction to the specs

`2026-08-10-notepad-tema-design.md` says the theme preference rides the existing `savePreferences`/`getAccount` pair with "no API change". **That is wrong and this plan does not do it.** Adding a theme to the server preference would require a new field on `PreferencesRequest` (`api/models.py:110`), on the `User` model, and in the `auth/me` response (`api/function_app.py:328`) — a real API change. It would also not help, because the theme has to apply on Landing, LockScreen and `/restore`, which run without a session.

The theme preference is therefore **device-local only** (`localStorage`, one global key, no username in it). This is also the better behaviour: a person may reasonably want Notepad on the desktop and the dark theme on the phone.

`2026-08-10-ubuntu-console-tema-design.md` lists `--caret-w` among the contract additions. This plan drops it: a token that no rule reads is dead weight in a contract every future theme has to answer. The terminal's block cursor is a structural rule using `caret-shape: block` instead (Task 8).

---

### Task 1: Radius tokens

**Files:**
- Create: `frontend/src/themeContract.test.ts`
- Modify: `frontend/src/App.css` (`:root` block at lines 1–23; 31 `border-radius` declarations)

**Interfaces:**
- Consumes: nothing.
- Produces: tokens `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg` declared in `App.css`'s `:root`. Task 3 moves them to `themes/contract.css` unchanged.

`App.css` currently uses seven distinct radii: 4, 6, 7, 8, 9, 10 and 12px. Four tokens cover them; three declarations are normalised to the nearest token, a deliberate 1–2px change:

- `.search-input` (line 388) 9px → `--radius-md` (8px)
- `.update-btn` (line 841) 7px → `--radius-md` (8px)
- `.update-banner` (line 829) 10px → `--radius-lg` (12px)

- [ ] **Step 1: Write the failing guard test**

Create `frontend/src/themeContract.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Component rules must never name a visual value directly — every colour,
// radius and font belongs to a theme token. This guard is the only thing
// standing between "two themes" and "one theme plus a broken one".
const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')

/** Lines that declare a token (`--name: value`) are the values themselves. */
function componentLines(source: string): { no: number; text: string }[] {
  return source
    .split('\n')
    .map((text, i) => ({ no: i + 1, text }))
    .filter(({ text }) => !/^\s*--[a-z0-9-]+\s*:/.test(text))
}

describe('App.css', () => {
  it('declares no literal border-radius', () => {
    const offenders = componentLines(css)
      .filter(({ text }) => /border-radius\s*:/.test(text))
      .filter(({ text }) => !/var\(--radius/.test(text))
      .map(({ no, text }) => `${no}: ${text.trim()}`)
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/themeContract.test.ts`
Expected: FAIL, listing 31 offending lines starting with `124: border-radius: 12px;`.

- [ ] **Step 3: Add the radius tokens**

In `frontend/src/App.css`, inside the existing `:root` block, after the `--font` line:

```css
  /* Corner radii. Every border-radius in this file uses one of these four —
     a theme that wants square corners sets them all to 0 in one place. */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
```

- [ ] **Step 4: Replace all 31 declarations**

Replace `border-radius: <value>;` with the token, by line:

| token | lines |
|---|---|
| `var(--radius-xs)` | 146 `.auth-card`, 241 `.recovery-code` |
| `var(--radius-sm)` | 907 `.account-badge`, 1274 `.tag-chip`, 1332 `.tag-pill`, 1345 `.tag-bar-chip` |
| `var(--radius-md)` | 183 `.auth-input`, 199 `.auth-btn`, 267 `.capture`, 388 `.search-input`, 596 `.composer-bar`, 670 `.note-detail`, 699 `.copy-btn`, 765 `.error-banner`, 777 `.offline-banner`, 788 `.verify-banner`, 841 `.update-btn`, 1002 `.landing-primary`, 1016 `.landing-secondary`, 1110 `.title-input`, 1216 `.markdown-body code`, 1223 `.markdown-body pre`, 1263 `.tag-chips`, 1308 `.tag-suggest`, 1371 `.feedback-input`, 1401 `.backup-input`, 1436 `.note-image`, 1489 `.lightbox-image` |
| `var(--radius-lg)` | 124 `.modal-card`, 829 `.update-banner`, 871 `.account-card` |

Work bottom-up so earlier edits do not shift later line numbers.

- [ ] **Step 5: Run the guard and the whole suite**

Run: `cd frontend && npm run test`
Expected: PASS, including `App.css > declares no literal border-radius`.

- [ ] **Step 6: Confirm the build is clean**

Run: `cd frontend && npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.css frontend/src/themeContract.test.ts
git commit -m "refactor(css): move every border-radius onto a token

Four radius tokens replace seven ad-hoc values. Three declarations are
normalised to the nearest token (search-input 9->8, update-btn 7->8,
update-banner 10->12); nothing else changes visually.

A guard test rejects any future literal border-radius in App.css."
```

---

### Task 2: Colour and shadow tokens

**Files:**
- Modify: `frontend/src/themeContract.test.ts` (add a second assertion)
- Modify: `frontend/src/App.css` (`:root`; 30 literal colour occurrences on 30 lines)

**Interfaces:**
- Consumes: the `:root` block and guard test from Task 1.
- Produces: 19 new tokens listed below, all declared in `App.css`'s `:root`.

Three alpha values are normalised so the contract stays small — imperceptible, but stated rather than hidden: `0.14 → 0.12` (`.tag-chip` background), `0.28 → 0.35` (`.search-input` border), `0.40 → 0.35` (`.auth-link.accent` and `.tag-chip` borders).

- [ ] **Step 1: Extend the guard test**

Add to the `describe('App.css', …)` block in `frontend/src/themeContract.test.ts`:

```ts
  it('names no literal colour', () => {
    const offenders = componentLines(css)
      .filter(({ text }) => /#[0-9A-Fa-f]{3,8}\b|\brgba?\(/.test(text))
      .map(({ no, text }) => `${no}: ${text.trim()}`)
    expect(offenders).toEqual([])
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/themeContract.test.ts`
Expected: FAIL, listing 30 lines starting with `112: background: rgba(6, 11, 22, 0.66);`.

- [ ] **Step 3: Add the tokens**

In `App.css`'s `:root`, after the radius tokens:

```css
  /* Text that sits on a filled --accent or --blue surface. */
  --on-accent: #06130D;
  --on-blue: #FFFFFF;
  --on-blue-dim: rgba(255, 255, 255, 0.8);

  /* Tinted washes and hairlines derived from the semantic hues. */
  --accent-soft: rgba(34, 177, 131, 0.12);
  --accent-soft-hover: rgba(34, 177, 131, 0.22);
  --accent-line: rgba(34, 177, 131, 0.35);
  --accent-line-strong: rgba(34, 177, 131, 0.5);
  --sky-soft: rgba(91, 141, 239, 0.14);
  --sky-pale: #8FB3F2;
  --danger-soft: rgba(224, 87, 74, 0.15);
  --blue-soft: rgba(46, 86, 160, 0.18);
  --blue-solid: rgba(46, 86, 160, 0.96);

  /* Inset fields that are a wash over the surface rather than their own colour. */
  --field: rgba(255, 255, 255, 0.04);
  --field-border: rgba(255, 255, 255, 0.14);

  /* Scrims and shadows. A flat theme sets the shadows to none. */
  --scrim: rgba(6, 11, 22, 0.66);
  --scrim-strong: rgba(6, 11, 22, 0.92);
  --shadow-modal: 0 24px 60px -24px rgba(0, 0, 0, 0.8);
  --shadow-banner: 0 6px 22px rgba(0, 0, 0, 0.35);
  --shadow-popover: 0 12px 30px -12px rgba(0, 0, 0, 0.7);
```

- [ ] **Step 4: Replace all 30 occurrences**

| line | selector | from | to |
|---|---|---|---|
| 112 | `.modal-overlay` | `rgba(6, 11, 22, 0.66)` | `var(--scrim)` |
| 126 | `.modal-card` | `0 24px 60px -24px rgba(0, 0, 0, 0.8)` | `var(--shadow-modal)` |
| 201 | `.auth-btn` | `#06130D` | `var(--on-accent)` |
| 227 | `.auth-link.accent` | `rgba(34, 177, 131, 0.4)` | `var(--accent-line)` |
| 317 | `.save-btn` | `#06130D` | `var(--on-accent)` |
| 387 | `.search-input` | `rgba(34, 177, 131, 0.28)` | `var(--accent-line)` |
| 481 | `.entry-image-flag .flag-frame` | `rgba(91, 141, 239, 0.14)` | `var(--sky-soft)` |
| 760 | `.error-banner` | `rgba(224, 87, 74, 0.15)` | `var(--danger-soft)` |
| 770 | `.offline-banner` | `rgba(46, 86, 160, 0.18)` | `var(--blue-soft)` |
| 783 | `.verify-banner` | `rgba(34, 177, 131, 0.12)` | `var(--accent-soft)` |
| 805 | `.verify-resend` | `rgba(34, 177, 131, 0.5)` | `var(--accent-line-strong)` |
| 824 | `.update-banner` | `rgba(46, 86, 160, 0.96)` | `var(--blue-solid)` |
| 826 | `.update-banner` | `#fff` | `var(--on-blue)` |
| 830 | `.update-banner` | `0 6px 22px rgba(0, 0, 0, 0.35)` | `var(--shadow-banner)` |
| 833 | `.update-btn` | `#fff` | `var(--on-blue)` |
| 846 | `.update-dismiss` | `rgba(255, 255, 255, 0.8)` | `var(--on-blue-dim)` |
| 1004 | `.landing-primary` | `#06130D` | `var(--on-accent)` |
| 1183 | `.markdown-body h6` | `#8fb3f2` | `var(--sky-pale)` |
| 1271 | `.tag-chip` | `rgba(34, 177, 131, 0.14)` | `var(--accent-soft)` |
| 1273 | `.tag-chip` | `rgba(34, 177, 131, 0.4)` | `var(--accent-line)` |
| 1310 | `.tag-suggest` | `0 12px 30px -12px rgba(0, 0, 0, 0.7)` | `var(--shadow-popover)` |
| 1329 | `.tag-pill` | `rgba(34, 177, 131, 0.12)` | `var(--accent-soft)` |
| 1331 | `.tag-pill` | `rgba(34, 177, 131, 0.35)` | `var(--accent-line)` |
| 1338 | `.tag-pill:hover` | `rgba(34, 177, 131, 0.22)` | `var(--accent-soft-hover)` |
| 1355 | `.tag-bar-chip.is-active` | `rgba(34, 177, 131, 0.12)` | `var(--accent-soft)` |
| 1369 | `.feedback-input` | `rgba(255, 255, 255, 0.04)` | `var(--field)` |
| 1370 | `.feedback-input` | `rgba(255, 255, 255, 0.14)` | `var(--field-border)` |
| 1399 | `.backup-input` | `rgba(255, 255, 255, 0.04)` | `var(--field)` |
| 1400 | `.backup-input` | `rgba(255, 255, 255, 0.14)` | `var(--field-border)` |
| 1474 | `.lightbox-overlay` | `rgba(6, 11, 22, 0.92)` | `var(--scrim-strong)` |

Work bottom-up.

- [ ] **Step 5: Run the suite**

Run: `cd frontend && npm run test`
Expected: PASS.

- [ ] **Step 6: Look at the running app**

Run: `cd frontend && npm run dev`
Check the note list, a note detail, the account page, a tag pill, the lightbox and the update banner. Nothing should look different.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.css frontend/src/themeContract.test.ts
git commit -m "refactor(css): move every colour and shadow onto a token

Seventeen tokens replace 30 literal colours. Three alpha values are
normalised to keep the contract small (0.14->0.12, 0.28->0.35,
0.40->0.35); nothing else changes visually.

The guard test now rejects literal colours in App.css too."
```

---

### Task 3: Split into `themes/` and add the registry

**Files:**
- Create: `frontend/src/themes/contract.css`
- Create: `frontend/src/themes/dossier.css`
- Create: `frontend/src/themes/registry.ts`
- Create: `frontend/src/themes/registry.test.ts`
- Create: `frontend/src/themes/parity.test.ts`
- Modify: `frontend/src/App.css` (remove the `:root` block, add two `@import`s at the very top)
- Modify: `frontend/src/themeContract.test.ts` (drop the now-dead token-line filter comment)

**Interfaces:**
- Consumes: the complete token set from Tasks 1–2.
- Produces:
  - `themes/contract.css` — every token declared once on `:root` with the dossier values as the fallback, including six chrome tokens (`--titlebar`, `--titlebar-ink`, `--select`, `--select-ink`, `--desktop`, `--link`) that no rule needed before but every later theme does.
  - `themes/dossier.css` — `:root[data-theme="dossier"] { … }` with the same values.
  - `registry.ts` — `export type ThemeId = 'dossier'`, `export interface ThemeMeta { id: ThemeId; nameKey: string; themeColor: string }`, `export const THEMES: Record<ThemeId, ThemeMeta>`, `export const THEME_IDS: ThemeId[]`, `export function isThemeId(v: unknown): v is ThemeId`.

- [ ] **Step 1: Write the failing parity test**

Create `frontend/src/themes/parity.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Adding a theme means answering the contract in full. This test is what makes
// "one file plus one registry line" true rather than aspirational.
const dir = fileURLToPath(new URL('.', import.meta.url))
const read = (file: string) => readFileSync(`${dir}${file}`, 'utf8')
const tokens = (css: string) => new Set(css.match(/--[a-z0-9-]+(?=\s*:)/g) ?? [])

const contract = tokens(read('contract.css'))
const themeFiles = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'contract.css')

describe('theme files', () => {
  it('finds at least one theme', () => {
    expect(themeFiles.length).toBeGreaterThan(0)
  })

  it.each(themeFiles)('%s answers the contract exactly', (file) => {
    const theme = tokens(read(file))
    const missing = [...contract].filter((t) => !theme.has(t)).sort()
    const extra = [...theme].filter((t) => !contract.has(t)).sort()
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: FAIL — the directory does not exist yet (`ENOENT`).

- [ ] **Step 3: Create `themes/contract.css`**

Cut the whole `:root { … }` block out of `App.css` — every line of it as it stands after Task 2, character for character — and paste it into `frontend/src/themes/contract.css` under this header comment:

```css
/* The theme contract: every value a theme is allowed to set, declared once.
   The values here are the dossier theme's, so an unknown or missing
   data-theme still renders a complete, correct app.

   Adding a token means adding it to every file in this directory —
   parity.test.ts enforces that. Keep the list short: each token is a promise
   to every future theme.

   A string is a value, visibility is structure: `content:` belongs in a
   token, toggling `display` belongs in a theme-scoped rule. */
:root {
  /* the moved block goes here, unchanged */
}
```

Then append the six **chrome tokens** — values no current rule needs, but every theme after dossier does. The dossier values below reproduce today's appearance exactly:

```css
  /* Window chrome. The dossier theme has no title bar; the themes that do
     paint one here rather than inventing their own colours. */
  --titlebar: transparent;
  --titlebar-ink: var(--ink-dim);

  /* The selected row in the note list. */
  --select: var(--surface-hover);
  --select-ink: var(--ink);

  /* The ground the sign-in and lock screens stand on. */
  --desktop: #0E1524;

  /* Links inside note content. */
  --link: var(--accent);
```

- [ ] **Step 4: Create `themes/dossier.css`**

Restate every declaration from `contract.css` — the moved block and the six chrome tokens — under the attribute selector:

```css
/* The original bpad look: a dark case-file dossier. */
:root[data-theme="dossier"] {
  /* the same declarations as contract.css, verbatim */
}
```

- [ ] **Step 5: Import them from `App.css`**

At the very top of `frontend/src/App.css` (CSS requires `@import` before any rule):

```css
@import './themes/contract.css';
@import './themes/dossier.css';
```

- [ ] **Step 6: Wire the chrome tokens into the three rules that have a counterpart today**

All three substitutions are no-ops in the dossier theme; they exist so the other themes have somewhere to reach.

`.auth-page` (line 133) — add a background it currently inherits from `body`:

```css
  background: var(--desktop);
```

`.markdown-body a` (line 1208) — `color: var(--accent);` becomes `color: var(--link);`

`.entry.is-active` (line 661, inside the `min-width: 860px` block):

```css
  .entry.is-active {
    background: var(--select);
    color: var(--select-ink);
    border-left-color: var(--accent);
  }
```

- [ ] **Step 7: Run the parity test**

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: PASS.

- [ ] **Step 8: Write the failing registry test**

Create `frontend/src/themes/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { THEMES, THEME_IDS, isThemeId } from './registry'

describe('theme registry', () => {
  it('lists every theme by its own id', () => {
    for (const id of THEME_IDS) {
      expect(THEMES[id].id).toBe(id)
    }
  })

  it('gives every theme a translation key and a browser chrome colour', () => {
    for (const id of THEME_IDS) {
      expect(THEMES[id].nameKey).toMatch(/^account\.theme[A-Z]/)
      expect(THEMES[id].themeColor).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('recognises only known ids', () => {
    expect(isThemeId('dossier')).toBe(true)
    expect(isThemeId('nope')).toBe(false)
    expect(isThemeId(null)).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
  })
})
```

- [ ] **Step 9: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/themes/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 10: Write the registry**

Create `frontend/src/themes/registry.ts`:

```ts
// The list of built-in themes. Adding one means adding a CSS file next to this
// one and a line here — nothing else. Display names live in i18n, so only the
// key travels in this table.
export type ThemeId = 'dossier'

export interface ThemeMeta {
  id: ThemeId
  /** i18n key for the name shown in the theme picker. */
  nameKey: string
  /** Drives <meta name="theme-color">, i.e. the browser/PWA chrome. */
  themeColor: string
}

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dossier: { id: 'dossier', nameKey: 'account.themeDossier', themeColor: '#0E1524' },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

export const DEFAULT_THEME: ThemeId = 'dossier'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && value in THEMES
}
```

- [ ] **Step 11: Run the whole suite and build**

Run: `cd frontend && npm run test && npm run build && npm run lint`
Expected: all pass. The app still looks unchanged — `contract.css` alone renders it.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/themes frontend/src/App.css frontend/src/themeContract.test.ts
git commit -m "refactor(css): split themes out of App.css

contract.css declares every token once with the dossier values as the
fallback, so an unknown data-theme still renders correctly. dossier.css
restates them under the attribute selector. registry.ts lists the themes.

parity.test.ts fails any theme file whose token set differs from the
contract — that is what makes adding a theme a one-file job."
```

---

### Task 4: Theme preference and boot

**Files:**
- Create: `frontend/src/themes/theme.ts`
- Create: `frontend/src/themes/theme.test.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `ThemeId`, `THEMES`, `DEFAULT_THEME`, `isThemeId` from `./registry`.
- Produces: `getThemePref(): ThemeId`, `setThemePref(id: ThemeId): void`, `applyTheme(id: ThemeId): void`, `initTheme(): ThemeId`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/themes/theme.test.ts`. There is no jsdom, so it stubs both globals itself:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getThemePref, initTheme, setThemePref } from './theme'

function stubStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  return store
}

function stubDocument() {
  const meta = { content: '', setAttribute(_: string, v: string) { this.content = v } }
  const root = { dataset: {} as Record<string, string> }
  vi.stubGlobal('document', {
    documentElement: root,
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null),
  })
  return { root, meta }
}

beforeEach(() => vi.unstubAllGlobals())

describe('theme preference', () => {
  it('defaults to dossier when nothing is stored', () => {
    stubStorage()
    expect(getThemePref()).toBe('dossier')
  })

  it('falls back to the default for an id this build does not know', () => {
    stubStorage({ 'bpad.pref.theme': 'neon-from-the-future' })
    expect(getThemePref()).toBe('dossier')
  })

  it('round-trips a stored preference', () => {
    stubStorage()
    setThemePref('dossier')
    expect(getThemePref()).toBe('dossier')
  })

  it('survives storage that refuses to write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    expect(() => setThemePref('dossier')).not.toThrow()
  })

  it('stamps the root element and the browser chrome colour', () => {
    const { root, meta } = stubDocument()
    applyTheme('dossier')
    expect(root.dataset.theme).toBe('dossier')
    expect(meta.content).toBe('#0E1524')
  })

  it('initTheme reads the preference and applies it in one call', () => {
    stubStorage()
    const { root } = stubDocument()
    expect(initTheme()).toBe('dossier')
    expect(root.dataset.theme).toBe('dossier')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd frontend && npx vitest run src/themes/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Write `theme.ts`**

```ts
// Device-local UI preference: which visual theme the app renders in.
//
// Deliberately NOT per user and NOT synced to the server, unlike the sort
// preference. It has to apply on Landing, LockScreen and /restore, none of
// which have a session — and wanting one theme on the desktop and another on
// the phone is reasonable, not a bug.
import { DEFAULT_THEME, THEMES, isThemeId, type ThemeId } from './registry'

const KEY = 'bpad.pref.theme'

export function getThemePref(): ThemeId {
  const raw = localStorage.getItem(KEY)
  return isThemeId(raw) ? raw : DEFAULT_THEME
}

export function setThemePref(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* quota / private mode – best-effort, mirrors the offline cache */
  }
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', THEMES[id].themeColor)
}

/** Read the stored preference and apply it. Call before the first render. */
export function initTheme(): ThemeId {
  const id = getThemePref()
  applyTheme(id)
  return id
}
```

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/themes/theme.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the meta tag the theme colour writes into**

In `frontend/index.html`, inside `<head>` after the viewport meta:

```html
    <meta name="theme-color" content="#0E1524" />
```

- [ ] **Step 6: Apply the theme before React renders**

In `frontend/src/main.tsx`, add the import next to the other local imports and call it above `createRoot`:

```ts
import { initTheme } from './themes/theme'

// Before the first render: otherwise the app paints the default theme and
// flashes when the stored one is applied.
initTheme()
```

- [ ] **Step 7: Verify there is no flash**

Run: `cd frontend && npm run dev`
In the browser console run `localStorage.setItem('bpad.pref.theme', 'dossier')`, reload, and confirm the page never paints a different background first. Confirm in DevTools that `<html>` carries `data-theme="dossier"` and the `theme-color` meta reads `#0E1524`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/themes/theme.ts frontend/src/themes/theme.test.ts frontend/src/main.tsx frontend/index.html
git commit -m "feat(themes): device-local theme preference applied before first render

Stored under one global localStorage key rather than per user, because the
theme must apply on Landing, LockScreen and /restore, which run without a
session. An unknown id falls back to the default, so a preference written by
a newer build cannot break an older one.

initTheme() runs above createRoot so the app never flashes the wrong theme,
and rewrites <meta name=theme-color> so the PWA chrome matches."
```

---

### Task 5: Theme picker on the Account page

**Files:**
- Modify: `frontend/src/i18n/en.ts` (the `account` section, after `language:` at line 135)
- Modify: `frontend/src/Account.tsx` (imports; the `account-card` block, after the language row that ends at line 136)

**Interfaces:**
- Consumes: `THEME_IDS`, `THEMES`, `type ThemeId` from `./themes/registry`; `getThemePref`, `setThemePref`, `applyTheme` from `./themes/theme`.
- Produces: nothing other tasks depend on.

The picker mirrors the existing language `<select>` exactly, including hiding itself while only one theme is registered — so this task can land before Notepad exists.

- [ ] **Step 1: Add the copy**

In `frontend/src/i18n/en.ts`, in the `account` section right after `language: 'language',`:

```ts
    theme: 'theme',
    themeDossier: 'Dossier (default)',
```

- [ ] **Step 2: Add the control**

In `frontend/src/Account.tsx`, add to the imports:

```ts
import { THEMES, THEME_IDS, type ThemeId } from './themes/registry'
import { applyTheme, getThemePref, setThemePref } from './themes/theme'
```

Add state next to the other `useState` calls:

```ts
  const [theme, setTheme] = useState<ThemeId>(getThemePref)
```

And the row, directly after the closing `)}` of the language block:

```tsx
        {THEME_IDS.length > 1 && (
          <div className="account-row">
            <span className="account-key">{t('account.theme')}</span>
            <select
              className="account-val"
              value={theme}
              onChange={(e) => {
                const id = e.target.value as ThemeId
                setTheme(id)
                setThemePref(id)
                applyTheme(id)
              }}
            >
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>{t(THEMES[id].nameKey)}</option>
              ))}
            </select>
          </div>
        )}
```

- [ ] **Step 3: Verify it is hidden**

Run: `cd frontend && npm run dev`
Open `/account`. With only `dossier` registered the theme row must **not** appear — same rule the language switcher already follows.

- [ ] **Step 4: Run the suite, build and lint**

Run: `cd frontend && npm run test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/Account.tsx frontend/src/i18n/en.ts
git commit -m "feat(themes): theme picker on the account page

Mirrors the language switcher, including staying hidden while only one
theme is registered — so it can ship before the second theme exists."
```

---

### Task 6: The Notepad theme

**Files:**
- Create: `frontend/src/themes/notepad.css`
- Modify: `frontend/src/themes/registry.ts`
- Modify: `frontend/src/App.css` (add the `@import`)
- Modify: `frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes: the full token contract; `parity.test.ts` from Task 3.
- Produces: `ThemeId` widens to `'dossier' | 'notepad'`.

Spec: `docs/superpowers/specs/2026-08-10-notepad-tema-design.md`. Read it before starting.

- [ ] **Step 1: Register the theme first, so the parity test fails**

In `frontend/src/themes/registry.ts`:

```ts
export type ThemeId = 'dossier' | 'notepad'
```

and add to `THEMES`:

```ts
  notepad: { id: 'notepad', nameKey: 'account.themeNotepad', themeColor: '#ECE9D8' },
```

- [ ] **Step 2: Create an empty theme file and watch parity fail**

Create `frontend/src/themes/notepad.css` containing only:

```css
/* Classic Windows Notepad, XP/Luna era. */
:root[data-theme="notepad"] {
}
```

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: FAIL — `notepad.css answers the contract exactly` lists every token under `missing`.

- [ ] **Step 3: Fill in the values**

Write the token block, using the failing test's `missing` list as the checklist. Values from the spec:

```css
:root[data-theme="notepad"] {
  --ground: #ECE9D8;
  --surface: #FFFFFF;
  --surface-hover: #D8E5F5;
  --ink: #000000;
  /* Not true Windows #808080: that is 3.4:1 on the dialog face and fails AA. */
  --ink-dim: #5A5750;
  --accent: #000080;
  --blue: #0A246A;
  --sky: #316AC5;
  --amber: #7F6000;
  --danger: #A00000;
  --hairline: #ACA899;
  --font: Tahoma, "MS Sans Serif", "Segoe UI", sans-serif;

  --radius-xs: 0px;
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;

  --on-accent: #FFFFFF;
  --on-blue: #FFFFFF;
  --on-blue-dim: rgba(255, 255, 255, 0.8);
  --accent-soft: #E4E9F5;
  --accent-soft-hover: #D8E5F5;
  --accent-line: #ACA899;
  --accent-line-strong: #808080;
  --sky-soft: #E4E9F5;
  --sky-pale: #0A246A;
  --danger-soft: #F5E4E4;
  --blue-soft: #E4E9F5;
  --blue-solid: #0A246A;
  --field: #FFFFFF;
  --field-border: #ACA899;
  --scrim: rgba(0, 0, 0, 0.3);
  --scrim-strong: rgba(0, 0, 0, 0.5);
  /* Hard shadows, no blur — a Win32 dialog does not glow. */
  --shadow-modal: 3px 3px 0 rgba(0, 0, 0, 0.35);
  --shadow-banner: 2px 2px 0 rgba(0, 0, 0, 0.25);
  --shadow-popover: 2px 2px 0 rgba(0, 0, 0, 0.35);

  --titlebar: linear-gradient(90deg, #0A246A 0%, #3A6EA5 60%, #A6CAF0 100%);
  --titlebar-ink: #FFFFFF;
  --select: #316AC5;
  --select-ink: #FFFFFF;
  --desktop: #3A6EA5;
  --link: #0000EE;
}
```

If the parity test still reports a token as missing, add it — the contract, not this listing, is the authority.

- [ ] **Step 4: Run parity**

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Import the theme and add its name**

In `frontend/src/App.css`, after the dossier import:

```css
@import './themes/notepad.css';
```

In `frontend/src/i18n/en.ts`, after `themeDossier`:

```ts
    themeNotepad: 'Notepad',
```

- [ ] **Step 6: Add the structural rules**

Append to `notepad.css`, below the token block. These are the rules tokens cannot express — keep the list short and comment why each one exists:

```css
/* Windows has no uppercase micro-labels and no letter-spacing. */
[data-theme="notepad"] .case-number,
[data-theme="notepad"] .section-label,
[data-theme="notepad"] .capture-label,
[data-theme="notepad"] .sort-toggle button,
[data-theme="notepad"] .account-key {
  text-transform: none;
  letter-spacing: 0;
}

/* Raised and pressed 3D edges. */
[data-theme="notepad"] .auth-btn,
[data-theme="notepad"] .save-btn,
[data-theme="notepad"] .ghost-btn,
[data-theme="notepad"] .copy-btn,
[data-theme="notepad"] .update-btn,
[data-theme="notepad"] .sort-toggle button {
  border: 0;
  min-width: 75px;
  box-shadow:
    inset -1px -1px 0 #0A0A0A, inset 1px 1px 0 #FFFFFF,
    inset -2px -2px 0 #808080, inset 2px 2px 0 #DFDFDF;
}
[data-theme="notepad"] .auth-btn:active,
[data-theme="notepad"] .save-btn:active,
[data-theme="notepad"] .ghost-btn:active,
[data-theme="notepad"] .copy-btn:active,
[data-theme="notepad"] .sort-toggle button.is-active {
  box-shadow:
    inset 1px 1px 0 #0A0A0A, inset -1px -1px 0 #FFFFFF,
    inset 2px 2px 0 #808080, inset -2px -2px 0 #DFDFDF;
}

/* Sunken fields and the note list as a listbox. */
[data-theme="notepad"] .auth-input,
[data-theme="notepad"] .search-input,
[data-theme="notepad"] .title-input,
[data-theme="notepad"] .feedback-input,
[data-theme="notepad"] .backup-input,
[data-theme="notepad"] .entries,
[data-theme="notepad"] .note-detail {
  box-shadow:
    inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF,
    inset 2px 2px 0 #0A0A0A, inset -2px -2px 0 #DFDFDF;
}
[data-theme="notepad"] .entries { gap: 0; padding: 3px; background: var(--surface); }
[data-theme="notepad"] .entry { border-left: 0; }

/* A listbox has no chevrons. (The selected row needs no rule — --select and
   --select-ink already carry it.) */
[data-theme="notepad"] .entry-chevron { display: none; }

/* The header becomes a title bar with a menu strip under it. The window
   buttons are one pseudo-element of pure decoration — no DOM change. */
[data-theme="notepad"] .app-header {
  background: var(--titlebar);
  color: var(--titlebar-ink);
  align-items: center;
  flex-wrap: wrap;
  border-bottom: 0;
  padding: 4px 6px;
  margin-bottom: 0;
}
[data-theme="notepad"] .app-title { font-size: 13px; font-weight: 700; }
[data-theme="notepad"] .case-number { display: none; }
[data-theme="notepad"] .app-header::after {
  content: "─  □  ✕";
  font-size: 11px;
  letter-spacing: 0.1em;
  padding-left: 10px;
}
[data-theme="notepad"] .app-meta {
  background: var(--ground);
  color: var(--ink);
  width: 100%;
  order: 3;
  justify-content: flex-start;
  gap: 2px;
  padding: 2px 4px;
  margin: 4px -6px -4px;
  border-bottom: 1px solid var(--hairline);
}
[data-theme="notepad"] .logout-link { padding: 3px 8px; }
[data-theme="notepad"] .logout-link:hover { background: var(--accent); color: #FFFFFF; }

/* The footer becomes a status bar: raised top edge, sunken cells. */
[data-theme="notepad"] .app-footer {
  background: var(--ground);
  border-top: 1px solid #FFFFFF;
  padding: 3px;
  gap: 3px;
}
[data-theme="notepad"] .app-footer-link,
[data-theme="notepad"] .app-footer-copy {
  padding: 2px 8px;
  box-shadow:
    inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF,
    inset 2px 2px 0 #0A0A0A, inset -2px -2px 0 #DFDFDF;
}

/* A modal is a dialog: its title is the title bar. */
[data-theme="notepad"] .modal-card { padding: 3px; }
[data-theme="notepad"] .modal-title {
  background: var(--titlebar);
  color: var(--titlebar-ink);
  font-size: 13px;
  padding: 3px 6px;
  margin: 0 0 10px;
}

/* Square scrollbars with 3D faces. Firefox keeps its own — acceptable. */
[data-theme="notepad"] ::-webkit-scrollbar { width: 16px; height: 16px; }
[data-theme="notepad"] ::-webkit-scrollbar-track { background: #DFDFDF; }
[data-theme="notepad"] ::-webkit-scrollbar-thumb {
  background: var(--ground);
  box-shadow:
    inset -1px -1px 0 #0A0A0A, inset 1px 1px 0 #FFFFFF,
    inset -2px -2px 0 #808080, inset 2px 2px 0 #DFDFDF;
}

/* The Win95 focus rectangle — period-correct and perfectly visible. */
[data-theme="notepad"] :focus-visible { outline: 1px dotted #000000; outline-offset: 1px; }

/* Note content is monospace; the rest of the UI is not. */
[data-theme="notepad"] .note-detail .markdown-body,
[data-theme="notepad"] .capture textarea {
  font-family: "Lucida Console", Consolas, "Courier New", monospace;
  font-size: 13px;
  line-height: 1.35;
}

/* A real 23px button is untappable. Touch wins over the era. */
@media (pointer: coarse) {
  [data-theme="notepad"] .auth-btn,
  [data-theme="notepad"] .save-btn,
  [data-theme="notepad"] .ghost-btn,
  [data-theme="notepad"] .entry-main {
    min-height: 42px;
  }
}
```

- [ ] **Step 7: Look at every screen in both themes**

Run: `cd frontend && npm run dev`
Switch the theme on `/account` and walk: note list, note detail, editor, tags, account, features, the login screen (log out), the lightbox. Then switch back to dossier and confirm nothing regressed.

- [ ] **Step 8: Run the suite, build and lint**

Run: `cd frontend && npm run test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/themes frontend/src/App.css frontend/src/i18n/en.ts
git commit -m "feat(themes): add the Notepad theme

XP/Luna palette, Tahoma UI, Lucida Console note content, 3D bevels and a
listbox note list. --ink-dim is #5A5750 rather than the true Windows
#808080, which is 3.4:1 on the dialog face and fails AA.

Touch targets keep a 42px minimum under pointer: coarse — a real 23px
Windows button cannot be tapped."
```

---

### Task 7: Contract additions and Ubuntu Mono

**Files:**
- Create: `frontend/public/fonts/UbuntuMono-Regular.woff2`
- Create: `frontend/public/fonts/UBUNTU-FONT-LICENCE.txt`
- Modify: `frontend/src/themes/contract.css`, `dossier.css`, `notepad.css`

**Interfaces:**
- Consumes: the contract from Task 3.
- Produces: four new tokens — `--radius-shell`, `--open`, `--close`, `--prompt` — defined in every existing theme.

This task must land before Task 8: `content: var(--open)` in a theme that never declares `--open` is undefined behaviour, not an empty string.

`workbox.globPatterns` in `frontend/vite.config.ts:35` is `['**/*.{js,css,html,svg,png,webmanifest}']` — it does **not** list `woff2`, so the font stays out of the precache with no config change. Do not add `woff2` to that list.

- [ ] **Step 1: Fetch the font and its licence**

Download `UbuntuMono-Regular.woff2` (latin subset) and the Ubuntu Font Licence 1.0 text into `frontend/public/fonts/`. Ubuntu Mono is UFL-licensed, which permits redistribution; the licence file must travel with it.

Verify: `ls -la frontend/public/fonts/` shows the woff2 at roughly 25–40 kB.

- [ ] **Step 2: Add the five tokens to the contract**

In `frontend/src/themes/contract.css`, at the end of the `:root` block:

```css
  /* The app shell's own corner: Ubuntu rounds the window but not the text
     area inside it, which --radius-* alone cannot express. */
  --radius-shell: 8px;

  /* Theme vocabulary. A terminal brackets its buttons and prompts with `$`;
     every other theme sets these to an empty string. */
  --open: "";
  --close: "";
  --prompt: "";
```

- [ ] **Step 3: Mirror them into the existing themes**

In `dossier.css`: `--radius-shell: 8px; --open: ""; --close: ""; --prompt: "";`
In `notepad.css`: `--radius-shell: 0px; --open: ""; --close: ""; --prompt: "";`

- [ ] **Step 4: Use the shell token**

In `frontend/src/App.css`, change `.account-card` (line 871) and `.modal-card` (line 124) from `var(--radius-lg)` to `var(--radius-shell)`.

- [ ] **Step 5: Run parity**

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: PASS — both existing themes answer the widened contract.

- [ ] **Step 6: Build and confirm the font is not precached**

Run: `cd frontend && npm run build`
Then: `grep -c woff2 dist/sw.js`
Expected: `0` — the font is served on demand, not precached.

- [ ] **Step 7: Commit**

```bash
git add frontend/public/fonts frontend/src/themes frontend/src/App.css
git commit -m "feat(themes): widen the contract for the terminal theme

Adds --radius-shell (Ubuntu rounds the window but not the text area inside
it) plus --open/--close/--prompt, empty in every theme but the terminal. A string is a value, visibility is structure: content strings earn
a token, display toggles stay structural rules.

Ubuntu Mono ships under UFL 1.0 and stays out of workbox globPatterns, so
only people who switch the theme on download it."
```

---

### Task 8: The Ubuntu console theme

**Files:**
- Create: `frontend/src/themes/ubuntu.css`
- Modify: `frontend/src/themes/registry.ts`, `frontend/src/App.css`, `frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes: the widened contract from Task 7.
- Produces: `ThemeId` widens to `'dossier' | 'notepad' | 'ubuntu'`.

Spec: `docs/superpowers/specs/2026-08-10-ubuntu-console-tema-design.md`. Read it before starting.

- [ ] **Step 1: Register the theme so parity fails**

In `registry.ts`, widen the union and add:

```ts
  ubuntu: { id: 'ubuntu', nameKey: 'account.themeUbuntu', themeColor: '#300A24' },
```

- [ ] **Step 2: Create the file with the font face and an empty block**

Create `frontend/src/themes/ubuntu.css`:

```css
/* GNOME Terminal on Ubuntu, default profile. */

/* Deliberately not precached: fetched only when someone picks this theme.
   Until it arrives the stack falls back to DejaVu Sans Mono, which is the
   other default GNOME Terminal face — so on Ubuntu it looks right regardless. */
@font-face {
  font-family: 'Ubuntu Mono';
  src: url('/fonts/UbuntuMono-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root[data-theme="ubuntu"] {
}
```

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: FAIL, listing every contract token as missing.

- [ ] **Step 3: Fill in the values**

```css
:root[data-theme="ubuntu"] {
  --ground: #300A24;
  /* A terminal has no cards: the surface is the same ground. */
  --surface: #300A24;
  --surface-hover: #45153A;
  --ink: #FFFFFF;
  --ink-dim: #B9A7B2;
  /* True Ubuntu orange #E95420 is 4.4:1 on the aubergine and misses AA. */
  --accent: #F07746;
  --blue: #3465A4;
  --sky: #729FCF;
  --amber: #FCE94F;
  --danger: #EF2929;
  --hairline: rgba(255, 255, 255, 0.15);
  --font: "Ubuntu Mono", ui-monospace, "DejaVu Sans Mono", "Liberation Mono", monospace;

  --radius-xs: 0px;
  --radius-sm: 0px;
  --radius-md: 0px;
  --radius-lg: 0px;
  --radius-shell: 12px;

  --on-accent: #300A24;
  --on-blue: #FFFFFF;
  --on-blue-dim: rgba(255, 255, 255, 0.8);
  --accent-soft: rgba(240, 119, 70, 0.14);
  --accent-soft-hover: rgba(240, 119, 70, 0.24);
  --accent-line: rgba(240, 119, 70, 0.38);
  --accent-line-strong: rgba(240, 119, 70, 0.6);
  --sky-soft: rgba(114, 159, 207, 0.16);
  --sky-pale: #729FCF;
  --danger-soft: rgba(239, 41, 41, 0.16);
  --blue-soft: rgba(52, 101, 164, 0.2);
  --blue-solid: #3465A4;
  --field: transparent;
  --field-border: rgba(255, 255, 255, 0.15);
  --scrim: rgba(20, 4, 15, 0.7);
  --scrim-strong: rgba(20, 4, 15, 0.92);
  --shadow-modal: 0 20px 50px rgba(0, 0, 0, 0.55);
  --shadow-banner: none;
  --shadow-popover: 0 10px 26px rgba(0, 0, 0, 0.5);

  --titlebar: #303030;
  --titlebar-ink: #FFFFFF;
  /* Inverted video, the way a terminal marks a selection. */
  --select: #FFFFFF;
  --select-ink: #300A24;
  --desktop: #2C001E;
  --link: #729FCF;

  --open: "[ ";
  --close: " ]";
  --prompt: "$";
}
```

Add whatever the test still reports as missing.

- [ ] **Step 4: Run parity**

Run: `cd frontend && npx vitest run src/themes/parity.test.ts`
Expected: PASS for all three theme files.

- [ ] **Step 5: Import it and add its name**

`App.css`: `@import './themes/ubuntu.css';`
`i18n/en.ts`, after `themeNotepad`: `themeUbuntu: 'Ubuntu console',`

- [ ] **Step 6: Add the six structural rules**

Append to `ubuntu.css`:

```css
/* Monospace with letter-spacing reads badly. */
[data-theme="ubuntu"] .case-number,
[data-theme="ubuntu"] .section-label,
[data-theme="ubuntu"] .capture-label,
[data-theme="ubuntu"] .sort-toggle button,
[data-theme="ubuntu"] .account-key {
  letter-spacing: 0;
}

/* Buttons are text in brackets, and hover inverts the way a TUI does. */
[data-theme="ubuntu"] .ghost-btn::before,
[data-theme="ubuntu"] .save-btn::before { content: var(--open); }
[data-theme="ubuntu"] .ghost-btn::after,
[data-theme="ubuntu"] .save-btn::after { content: var(--close); }
[data-theme="ubuntu"] .ghost-btn:hover,
[data-theme="ubuntu"] .save-btn:hover {
  background: var(--accent);
  color: var(--on-accent);
}

/* The search field has a prompt, not a magnifier. */
[data-theme="ubuntu"] .search-icon { display: none; }
[data-theme="ubuntu"] .search::before {
  content: var(--prompt);
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--accent);
  pointer-events: none;
}
[data-theme="ubuntu"] .search-input { padding-left: 28px; }

/* A dense listing. The inverted-video selection needs no rule at all —
   --select and --select-ink already say it. */
[data-theme="ubuntu"] .entries { gap: 0; }
[data-theme="ubuntu"] .entry { border-left: 0; }
[data-theme="ubuntu"] .entry-chevron { display: none; }

/* A Yaru header bar: centred title, window buttons as decoration. */
[data-theme="ubuntu"] .app-header {
  background: var(--titlebar);
  color: var(--titlebar-ink);
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  position: relative;
  border-bottom: 0;
  padding: 8px 12px;
}
[data-theme="ubuntu"] .app-meta {
  order: 3;
  width: 100%;
  justify-content: flex-start;
  gap: 18px;
  background: var(--ground);
  color: var(--ink-dim);
  padding: 6px 12px;
  margin: 8px -12px -8px;
}
[data-theme="ubuntu"] .case-number { display: none; }
[data-theme="ubuntu"] .app-title { font-size: 14px; font-weight: 400; }
[data-theme="ubuntu"] .app-header::before {
  content: "+";
  position: absolute;
  left: 12px;
}
[data-theme="ubuntu"] .app-header::after {
  content: "☰  ✕";
  position: absolute;
  right: 12px;
}

/* A terminal has a block cursor. Chrome 137+ honours this; everywhere else
   it stays a bar, which is a fallback rather than a bug. */
[data-theme="ubuntu"] .capture textarea,
[data-theme="ubuntu"] .title-input {
  caret-shape: block;
}

/* Thin GNOME overlay scrollbars. */
[data-theme="ubuntu"] ::-webkit-scrollbar { width: 8px; height: 8px; }
[data-theme="ubuntu"] ::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.28);
  border-radius: 4px;
}
[data-theme="ubuntu"] ::-webkit-scrollbar-track { background: transparent; }

/* Touch wins over the era here too. */
@media (pointer: coarse) {
  [data-theme="ubuntu"] .entry-main,
  [data-theme="ubuntu"] .ghost-btn,
  [data-theme="ubuntu"] .save-btn { min-height: 42px; }
}
```

- [ ] **Step 7: Verify the font actually loads and is not precached**

Run: `cd frontend && npm run dev`
Switch to Ubuntu console on `/account`. In DevTools → Network, filter `woff2` and confirm `UbuntuMono-Regular.woff2` is requested **only** after the switch, not on first load of the dossier theme. In Elements, confirm `<html data-theme="ubuntu">` and a `theme-color` of `#300A24`.

- [ ] **Step 8: Walk all three themes**

Note list, note detail, editor, tags, account, features, login, lightbox — in dossier, notepad and ubuntu. Confirm the two earlier themes are untouched.

- [ ] **Step 9: Run the suite, build and lint**

Run: `cd frontend && npm run test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/themes frontend/src/App.css frontend/src/i18n/en.ts
git commit -m "feat(themes): add the Ubuntu console theme

GNOME Terminal default profile: #300A24 aubergine, Tango palette, Ubuntu
Mono, inverted-video selection, bracketed buttons and a \$ search prompt.
--accent is #F07746 rather than #E95420, which is 4.4:1 on the aubergine.

Six structural rules against Notepad's dozen — a terminal has no cards,
bevels or button chrome to reproduce."
```

---

## Notes for the reviewer

**Where the risk is.** Tasks 1–3 touch every visual rule in the app and are supposed to change nothing. Review them by looking at the running app, not only at the diff — the guards prove no literal survives, not that the substitution was correct.

**Seven deliberate normalisations**, all in Tasks 1–2 and listed there: three radii (9→8, 7→8, 10→12) and four alpha values (0.14→0.12, 0.28→0.35, and two 0.40→0.35).

**Task ordering.** Tasks 1→2→3→4 are strictly sequential. Task 5 needs 3 and 4. Tasks 6 and 8 are independent of each other, but 8 needs 7, and 7 needs 3. Landing Tasks 1–3 alone is worthwhile even if the themes never ship.

**What is not covered here**, both by decision in the specs: plugins or user-supplied themes, and any server-side sync of the theme preference.
