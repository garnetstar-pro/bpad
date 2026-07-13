# Two-Pane Notes Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On desktop, show the notes list in a left column beside the open note's detail on the right; on mobile keep today's behavior (list, then detail replaces it when a note is opened).

**Architecture:** Introduce a `NotesLayout` route that always renders the list pane on the left and a React-Router `<Outlet/>` on the right; the child routes (`/` → placeholder, `/notes/:id` → detail) render into the outlet. The list stays mounted across note selection, so it must refetch when a note is created/updated/deleted — done via a dedicated `bpad:notes-mutated` event (kept separate from the existing `bpad:notes-changed` to avoid a refetch loop). Desktop vs. mobile is pure CSS: a two-column grid at `min-width: 860px`, single pane with route-driven show/hide below.

**Tech Stack:** React 19, TypeScript, Vite, react-router-dom v6 (already a dependency), oxlint, vitest. Existing i18n `t()`/`translate()` layer. No backend changes.

## Global Constraints

- User-facing copy is **English**, added to `frontend/src/i18n/en.ts` and read via `t()`/`translate()` — never hardcode strings in components.
- Code comments and logs are **English**.
- No changes to `api/` (backend). This is a frontend-only change.
- Type-check must pass: `npm run build` runs `tsc -b` then `vite build`. Lint must pass: `npm run lint` (oxlint), zero errors.
- Follow existing CSS custom-property tokens (`--surface`, `--ink`, `--accent`, `--hairline`, …) already defined at the top of `frontend/src/App.css`. Do not introduce new hardcoded colors.
- All commands below run from `frontend/` (i.e. `cd frontend` first).

---

### Task 1: List refetches when notes are mutated

**Why:** In the two-pane layout the list stays mounted while the detail deletes/edits a note. Today the list only fetches on mount and relies on `navigate('/')` remounting it. We need a signal that survives without a remount. The existing `bpad:notes-changed` event is dispatched from inside `listNotes` (via `setKnownNoteCount`), so a listener that calls `listNotes` on it would loop forever. Add a distinct mutation-only event.

**Files:**
- Modify: `frontend/src/api.ts` (add `bpad:notes-mutated` dispatch to `createNote`, `updateNote`, `deleteNote`)
- Modify: `frontend/src/Home.tsx` (subscribe and refetch)

**Interfaces:**
- Produces: a window event named `bpad:notes-mutated`, dispatched after any successful note create/update/delete. Consumed only by the list pane (`Home`).

- [ ] **Step 1: Add a mutation notifier in `api.ts`**

Near the existing `setKnownNoteCount` helper (around line 26), add:

```ts
// Fired only on create/update/delete (not on plain list reads), so a mounted
// list can refetch without the feedback loop that listening to
// `bpad:notes-changed` (dispatched inside listNotes) would cause.
function notifyNotesMutated(): void {
  window.dispatchEvent(new Event('bpad:notes-mutated'))
}
```

- [ ] **Step 2: Call it at the end of each successful mutation**

In `createNote`, after the note is parsed and before `return`, add `notifyNotesMutated()`.
In `updateNote`, same — after success, before `return`.
In `deleteNote`, after the request succeeds (after `checkAuth`/ok check), add `notifyNotesMutated()`.

(These functions already exist at api.ts:130 `createNote`, api.ts:155 `updateNote`, api.ts:176 `deleteNote`. Do not touch `listNotes`.)

- [ ] **Step 3: Subscribe in `Home.tsx`**

`Home` already declares `fetchNotes` and a mount `useEffect` (Home.tsx:39-53). Add a second effect below the existing one:

```tsx
// Keep the persistent list pane in sync when the detail pane mutates a note.
useEffect(() => {
  const refetch = () => { fetchNotes() }
  window.addEventListener('bpad:notes-mutated', refetch)
  return () => window.removeEventListener('bpad:notes-mutated', refetch)
}, [])
```

Leave the optimistic prepend in `handleCreate` as-is; the follow-up refetch simply reconciles.

- [ ] **Step 4: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, lint reports 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/Home.tsx
git commit -m "Refetch the notes list on note mutations

Add a dedicated bpad:notes-mutated event (create/update/delete) so a
persistently-mounted list can refresh without the loop that listening to
bpad:notes-changed would cause.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Detail-pane placeholder for the empty state

**Why:** On desktop at `/` (no note open) the right pane needs something to show. On mobile this placeholder is hidden by CSS (Task 5).

**Files:**
- Create: `frontend/src/DetailPlaceholder.tsx`
- Modify: `frontend/src/i18n/en.ts` (add `notes.selectPrompt`)

**Interfaces:**
- Produces: `export default function DetailPlaceholder()` — a self-contained component rendering `<div className="detail-placeholder">…</div>`.

- [ ] **Step 1: Add the i18n key**

In `frontend/src/i18n/en.ts`, inside the `notes` object (after `back:` on line 43), add:

```ts
    selectPrompt: 'Select a note to read it here.',
```

- [ ] **Step 2: Create the component**

`frontend/src/DetailPlaceholder.tsx`:

```tsx
import { useTranslation } from './i18n'

// Right-pane filler on desktop when no note is open. Hidden on mobile via CSS.
export default function DetailPlaceholder() {
  const { t } = useTranslation()
  return <div className="detail-placeholder">{t('notes.selectPrompt')}</div>
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds (the component is unused until Task 3, which is fine — it's exported and imported nowhere yet, so `tsc` will not error; if lint flags an unused file it will not, oxlint checks per-file usage not cross-file). If the build errors on an unused import, remove nothing — proceed to Task 3 which wires it up, then re-run.
Expected: 0 lint errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/DetailPlaceholder.tsx frontend/src/i18n/en.ts
git commit -m "Add detail-pane placeholder for the empty selection state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: NotesLayout and nested routes

**Why:** This is the structural change: the list must stay mounted while the detail changes. A layout route with `<Outlet/>` does exactly that.

**Files:**
- Create: `frontend/src/NotesLayout.tsx`
- Modify: `frontend/src/App.tsx` (replace the `<Routes>` block)

**Interfaces:**
- Consumes: `Home` (list pane), `DetailPlaceholder` (Task 2), `NoteDetail` (unchanged, rendered via child route).
- Produces: `export default function NotesLayout()` rendering `.notes-layout > .list-pane (<Home/>) + .detail-pane (<Outlet/>)`, with a `has-selection` class on the root when the URL matches `/notes/:id`.

- [ ] **Step 1: Create `NotesLayout.tsx`**

```tsx
import { Outlet, useMatch } from 'react-router-dom'
import Home from './Home'

// Desktop: list (left) + detail outlet (right), both always visible.
// Mobile: CSS shows one pane at a time — the list, or the detail when a note
// is selected (root gets `has-selection`).
export default function NotesLayout() {
  const selected = useMatch('/notes/:id')
  return (
    <div className={`notes-layout ${selected ? 'has-selection' : ''}`}>
      <div className="list-pane">
        <Home />
      </div>
      <div className="detail-pane">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewire the routes in `App.tsx`**

Add imports near the other page imports (App.tsx:16-21):

```tsx
import NotesLayout from './NotesLayout'
import DetailPlaceholder from './DetailPlaceholder'
```

Replace the existing `<Routes>…</Routes>` block (App.tsx:131-138) with:

```tsx
      <Routes>
        <Route element={<NotesLayout />}>
          <Route path="/" element={<DetailPlaceholder />} />
          <Route path="/notes/:id" element={<NoteDetail />} />
        </Route>
        <Route path="/account" element={<Account />} />
        <Route path="/features" element={<Features />} />
        {/* Catch-all: captures dev.bpad.pro/https://… or falls back home */}
        <Route path="*" element={<Capture />} />
      </Routes>
```

`Home` is now imported by `NotesLayout` rather than `App`. Remove the now-unused `import Home from './Home'` line from `App.tsx` (App.tsx:16) — otherwise oxlint flags an unused import. Keep the `NoteDetail` import (still referenced in the child route).

- [ ] **Step 3: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, 0 lint errors. If lint reports `Home` unused in App.tsx, remove that import line.

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open the app, log in. At this point the panes are stacked (no CSS yet) but functional: the list shows, clicking a note shows its detail below, `/` shows the placeholder text. Deleting a note in the detail returns to `/` and the list no longer shows it (Task 1 event). Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/NotesLayout.tsx frontend/src/App.tsx
git commit -m "Render notes list and detail under a shared layout route

The list now stays mounted (list-pane) while the note detail renders into
an Outlet, laying the groundwork for the desktop two-pane view. Routing
behavior is unchanged until the CSS lands.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Highlight the open note in the list

**Why:** In a two-pane view the user needs to see which row is open.

**Files:**
- Modify: `frontend/src/Home.tsx`

**Interfaces:**
- Consumes: the `/notes/:id` route match to know the active id.

- [ ] **Step 1: Read the active id**

In `Home.tsx`, add `useMatch` to the react-router import (Home.tsx:2):

```tsx
import { Link, useMatch, useSearchParams } from 'react-router-dom'
```

Inside the component, near the other hooks, add:

```tsx
const activeId = useMatch('/notes/:id')?.params.id
```

- [ ] **Step 2: Mark the active row**

In the list `.map` (Home.tsx:130-131), change the entry wrapper className to include an active modifier:

```tsx
<div className={`entry ${note.id === activeId ? 'is-active' : ''}`} key={note.id}>
```

(The `.entry.is-active` style is added in Task 5.)

- [ ] **Step 3: Type-check and lint**

Run: `npm run build && npm run lint`
Expected: build succeeds, 0 lint errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/Home.tsx
git commit -m "Mark the open note's row as active in the list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Two-pane CSS (desktop grid, mobile single-pane)

**Why:** This is where the actual layout happens: side-by-side on desktop, one-pane-at-a-time on mobile.

**Files:**
- Modify: `frontend/src/App.css`

**Design:**
- Default (mobile-first): single column. Show only the list at `/`, only the detail at `/notes/:id`. Driven by the `has-selection` class on `.notes-layout`.
- At `min-width: 860px`: two-column grid, both panes always visible; hide the now-redundant detail back-link and let the sticky list scroll independently.

- [ ] **Step 1: Add the layout block to `App.css`**

Append near the note-detail styles (after the `.note-detail` rules, ~line 490). Use existing tokens only:

```css
/* ---- Two-pane notes layout ---- */
.notes-layout {
  display: block;
}

/* Mobile / narrow: one pane at a time. */
.notes-layout .detail-pane { display: none; }
.notes-layout .list-pane { display: block; }
.notes-layout.has-selection .list-pane { display: none; }
.notes-layout.has-selection .detail-pane { display: block; }

/* The empty-state filler is only meaningful on desktop. */
.detail-placeholder {
  display: none;
  color: var(--ink-dim);
  font-size: 13px;
  padding: 40px 8px;
  text-align: center;
}

/* Desktop: list column beside detail column. */
@media (min-width: 860px) {
  .notes-layout {
    display: grid;
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    gap: 28px;
    align-items: start;
  }
  /* Both panes always visible regardless of selection. */
  .notes-layout .list-pane,
  .notes-layout.has-selection .list-pane,
  .notes-layout .detail-pane,
  .notes-layout.has-selection .detail-pane {
    display: block;
    min-width: 0;
  }
  .detail-placeholder { display: block; }
  /* The "back to list" link is redundant when the list is always visible. */
  .detail-pane .back-link { display: none; }
  /* Active row cue. */
  .entry.is-active {
    background: var(--surface-hover);
    border-left-color: var(--accent);
  }
}
```

Note: `.entry` already has a transparent `border-left` (App.css:395 area) so `border-left-color` animates cleanly; if `.entry` lacks a `border-left`, add `border-left: 2px solid transparent;` to the base `.entry` rule.

- [ ] **Step 2: Verify the base `.entry` has a transparent left border**

Read `.entry` (App.css:395). If it does not already declare `border-left`, add `border-left: 2px solid transparent;` to it so the active cue has something to color. If it already has the accent left-border on hover, mirror that value.

- [ ] **Step 3: Build**

Run: `npm run build && npm run lint`
Expected: build succeeds, 0 lint errors.

- [ ] **Step 4: Manual verification at both widths**

Run `npm run dev`. Then:
- Desktop (window ≥ 860px): list on the left, detail on the right. At `/` the right pane shows the placeholder text. Click a note → it opens on the right, the list stays put and its row is highlighted. Click another → detail swaps, list stays. Delete → list updates, right pane returns to placeholder. No horizontal page scroll.
- Mobile (narrow the window < 860px, or devtools device mode): only the list shows at `/`; opening a note shows only the detail with its "← back to list" link; back returns to the list. Matches today's behavior.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.css
git commit -m "Lay out notes as list + detail panes on desktop

Two-column grid at >=860px with both panes always visible and the open
note highlighted; below that, one pane at a time (list, or detail when a
note is selected) as before.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification

**Why:** Confirm the whole flow holds together and nothing regressed in the auth/other routes.

**Files:** none (verification only).

- [ ] **Step 1: Full build + lint + unit tests**

Run: `npm run build && npm run lint && npx vitest run`
Expected: build succeeds, 0 lint errors, all existing tests pass (no test count regression).

- [ ] **Step 2: Route regression check**

Run `npm run dev`, then confirm the non-notes routes still render full-width and unaffected: `/account`, `/features`, and a capture URL (`/<something>`) fall through to their own routes, not the two-pane layout. Stop the dev server.

- [ ] **Step 3: Final confirmation**

Report to the requester: two-pane on desktop, single-pane on mobile, list/detail stay in sync on create/update/delete, other routes unchanged. No backend changes were made.

---

## Notes / possible follow-ups (out of scope)

- **Container width:** the two-pane fits inside the existing 900px `.app` column (list 320px + detail ~1fr). If the detail feels cramped, a follow-up can widen `.app` to ~1040px at `min-width: 860px`. Left out here to keep the change minimal.
- **Independent pane scrolling / sticky list:** the list and detail currently scroll with the page. Making the list a sticky, independently-scrolling column is a nice-to-have, not required for the requested layout.
- **Navigate-to-new-note on create:** create still just prepends to the list; auto-opening the new note in the detail pane could be a later UX tweak.
