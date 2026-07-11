# Design brief: "bpad" — a personal markdown notebook

You are a senior product/UI designer. Design a complete, responsive web
interface for **bpad**, a minimalist personal note-taking web app. Deliver a
cohesive visual system and layouts for every screen and every UI state listed
below. Nothing in this brief should be left undesigned.

## Product in one line
A private, single-user scratchpad where the user quickly captures thoughts and
links written in **Markdown**, then browses, searches, reads, edits, and deletes
them. Tagline in the current UI: "access: you only" — it is a personal space,
not multi-user or social.

## Users & principles
- **One user, personal use.** No auth screens, no sharing, no collaboration UI.
- **Capture-first:** writing a new note must be the fastest, most prominent
  action. Reading/searching is secondary but frequent.
- **Keyboard-friendly** (power user): shortcuts matter (e.g. Ctrl/Cmd+Enter to
  save).
- **Calm, low-chrome, content-forward.** Text is the hero.

## Information architecture (2 routes)
1. **Home / list** (`/`)
2. **Note detail** (`/notes/:id`) — each note has its own shareable URL

A shared **Editor** component is used both for creating (on Home) and editing
(on Detail).

## Screen 1 — Home / list (`/`)
Contains, top to bottom:
- **App header:** small eyebrow label ("case file · bpad.pro"), the wordmark
  "bpad", and a right-aligned meta line ("access: you only"). Header links back
  to Home.
- **Capture editor** (the shared Editor, see below) — the primary CTA area for
  writing a new note.
- **Search field:** filters the list live as the user types; matches note title
  and body; case- and accent-insensitive. Needs a clear (×) affordance and a
  result counter (e.g. "3 / 12").
- **Section label:** "recent entries".
- **Notes list:** each row shows a timestamp, the note's title, and a chevron
  indicating it's tappable; the whole row links to the note's detail. Design
  hover/focus/active states. Rows should be full-width on desktop.

## Screen 2 — Note detail (`/notes/:id`)
- **Back link** to the list.
- **Reading view:** the note's timestamp and its **rendered Markdown** body,
  constrained to a comfortable reading measure (~65–75 characters) even though
  the list is full-width.
- **Actions:** primary **Edit** and secondary/destructive **Delete** (Delete
  asks for confirmation).
- Editing swaps the reading view in place for the **Editor** (prefilled), with
  **Save** and **Cancel**.

## Shared component — Editor (create & edit)
- **Write / Preview toggle** (tabbed).
- **Write mode:** a Markdown textarea that **auto-grows** with content up to a
  max height, then scrolls. Placeholder prompt for new notes.
- **Preview mode:** renders the Markdown; show an empty-preview hint when there's
  nothing to preview.
- **Footer:** a hint ("ctrl+enter or click …"), a primary submit button
  (label varies: "File it" for new, "Save" for edit), and a "Cancel" for edit.
- **Saving state** and an inline **error** message on failure.

## Markdown rendering — must be styled
The body renders GitHub-flavored Markdown. Provide styles for: h1–h4,
paragraphs, **bold**, *italic*, links, inline `code`, fenced code blocks,
blockquotes, unordered/ordered lists, task lists, tables (horizontally
scrollable on narrow screens), images (never overflow), and horizontal rules.

## Every UI state to design (do not skip)
- List: **loading**, **empty** ("no entries yet"), populated, and
  **search-no-results** ("nothing found").
- Detail: **loading**, **found**, **not-found / error**, and **edit** mode.
- Editor: empty, filled, **preview**, **empty preview**, **saving**, **error**.
- Delete: confirmation moment and in-progress ("deleting…").
- Generic **error banner** (e.g. backend unreachable).

## Data each note carries (for realistic mockups)
- **title** — auto-derived from the first Markdown heading (or first line);
  plain text, single line, may be long → design truncation.
- **content** — the full Markdown body (short notes to long articles).
- **created_at** — timestamp (shown as time in the list, fuller date on detail).
- **url** — an optional external link the note references (not currently
  surfaced in the UI; propose how/if to show it).

## Responsive requirements
- **Mobile-first.** On small screens use nearly the full width — avoid decorative
  side margins; keep tap targets comfortable.
- **Desktop:** the list, header, and editor use the full width; only the detail
  reading text is constrained to a readable column.
- Define breakpoints, spacing scale, and how the header/editor/list reflow.

## Visual system to deliver
- **Typography** (the current app uses a monospace, "dossier" feel — you may keep
  or evolve this; justify your choice), type scale, and hierarchy.
- **Color:** a coherent palette with **both light and dark themes**; the current
  app is dark, ink-on-near-black with a single warm-red accent (used for the
  primary button, active tab, hover accents). Define semantic colors (surface,
  hairline/border, ink, dim ink, accent, danger).
- Components: buttons (primary / ghost / destructive), inputs, tabs, list rows,
  cards, banners (error), empty states, chevrons/icons.
- **Accessibility:** WCAG AA contrast, visible focus states, keyboard operability,
  reduced-motion consideration.

## Deliverables
- High-fidelity mockups for **Home** (loading, empty, populated, searching),
  **Detail** (read, edit, not-found), and the **Editor** (write, preview,
  saving/error), in **mobile and desktop**, in **light and dark**.
- A component/style sheet: colors (with tokens), typography, spacing, and each
  reusable component with its states.
- Short rationale for the visual direction.

## Constraints
- No new features beyond what's described (no tags, folders, auth, or
  multi-user). Keep it minimal, fast, and text-focused.
- Current tone is a private "case file / field notebook." Honor that spirit
  unless you present a clearly stronger direction.
