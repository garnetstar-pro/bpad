# Note tags: grouping, filtering, and a soft premium cap

**Date:** 2026-07-12
**Status:** Approved design

## Problem

Users want to group notes. Tags fit best. We need: an easy way to add tags, a
way to filter by several tags (or by "untagged"), tag suggestions so the same
tag isn't retyped inconsistently, and a hook to cap the number of tags on the
free tier (premium lifts it later).

## Constraint that shapes everything

Notes are end-to-end encrypted: the server only ever sees `iv + ct`, never the
content. So **tags are encrypted metadata inside the payload**, and **all tag
work (filtering, suggestions) is client-side** — exactly like the existing
diacritics-insensitive search, which already decrypts every note in the browser
and filters there. A consequence: a premium "max N tags" limit **cannot be
enforced server-side** (the server can't count tags it can't see); the cap is a
**client-side soft limit**.

## Decisions (locked during brainstorming)

1. **Tags are a structured field**, not inline `#hashtags`: the encrypted
   payload becomes `{ title, content, url, tags }`.
2. **Input:** a dedicated chip-input field in the editor (separate from the
   body) with **autocomplete** from the user's existing tags.
3. **Suggestions come from a derived registry** — the union of all tags across
   the user's notes, computed client-side. No separate stored tag registry
   (global rename / colors / unused tags) is built now (deferred, YAGNI).
4. **Filter:** a tag bar above the list; selecting multiple tags is **AND**;
   plus an **"untagged"** filter. Composes with the text search. State in the
   URL (`?tags=…`).
5. **Display:** tags render as a **row of accent pills** under the note title
   (in detail and on list entries); clicking a pill filters. Not inline in the
   rendered body (tags aren't in the body in this model).
6. **Premium cap:** `FREE_TAG_LIMIT = 5` tags per note + an `isPremium()` hook
   (stub → `false`). **Behavior now: a non-blocking nudge** — over the limit
   shows a message but still saves; flip to hard-enforce when subscriptions
   ship.

## Non-goals

- Server-side tag enforcement or server-visible tag metadata.
- A stored, global tag registry (rename across notes, tag colors, tags with no
  notes). The derived union covers suggestions/filtering without it.
- Real subscription/checkout — `isPremium()` is a stub returning `false`.
- OR filtering or an AND/OR toggle (AND only).

## Design

### 1. Data model

- `NotePayload` (in `api.ts`) gains `tags: string[]`. The wire/storage shape is
  unchanged (`iv + ct`); tags live inside the ciphertext.
- `Note` (in `types.ts`) gains `tags: string[]`.
- **Backward compatibility:** a note encrypted before this change has no `tags`
  key → treat as `[]` (`payload.tags ?? []` on decrypt).

### 2. Tag normalization & the derived registry — `tags.ts`

- `normalizeTag(raw: string): string` — `trim`, strip a leading `#` (typed out
  of habit), collapse internal whitespace to a single space, `toLowerCase()`.
  Returns `''` for empty; callers drop empties.
- `normalizeTags(raw: string[]): string[]` — normalize each, drop empties,
  dedupe preserving first-seen order.
- `FREE_TAG_LIMIT = 5`.
- `filterByTags(notes: Note[], selected: string[], untaggedOnly: boolean): Note[]`
  - `untaggedOnly` → notes with `tags.length === 0`.
  - else if `selected.length` → notes where **every** selected tag is in
    `note.tags` (AND).
  - else → all notes unchanged.
- The **derived registry** (all known tags) is maintained in `api.ts` as a
  module-level set, mirroring the existing `knownNoteCount` pattern:
  - `getKnownTags(): string[]` — sorted union of tags across the user's notes.
  - Updated in `listNotes` (recompute the union from the decrypted notes) and on
    `createNote`/`updateNote` (merge the saved note's tags in).

### 3. Editor input — `TagInput.tsx`

A controlled chip-input rendered in the editor (create + edit), separate from
the body:
- Props: `value: string[]`, `onChange: (tags: string[]) => void`,
  `suggestions: string[]`.
- Typing text + **Enter** or **comma** commits `normalizeTag(input)` as a chip
  (deduped). **Backspace** on empty input removes the last chip. Each chip has
  an `×` to remove it.
- **Autocomplete:** while typing, show a dropdown of `suggestions` whose value
  starts with (or contains) the current input and isn't already selected; click
  or Enter to add. Suggestions come from `getKnownTags()`.
- Escape / blur closes the dropdown.

### 4. Editor wiring — `Editor.tsx`

- `EditorProps` gains `initialTags?: string[]`; `onSubmit` signature becomes
  `(content: string, title?: string, tags?: string[]) => Promise<void>`.
- Editor holds `tags` state (init from `initialTags`). Renders `<TagInput>`
  above the write/preview tabs, passing `getKnownTags()` as suggestions.
- On submit, passes the current tags.
- **Premium nudge (soft):** when `!isPremium() && tags.length > FREE_TAG_LIMIT`,
  render a non-blocking hint under the tag input
  (`t('tags.overLimit', { limit })`). **Saving is not blocked.**

### 5. Display — pill row

- A small presentational `TagPills` (can live in `TagInput.tsx` or its own
  file): renders a row of accent pills for a `tags: string[]`; each pill is a
  `<Link to={/?tags=<tag>}>` (URL-encoded) so clicking filters.
- Rendered:
  - in `NoteDetail` under the title,
  - on each `Home` list entry (compact).

### 6. Filtering — `TagBar.tsx` + `Home.tsx`

- `TagBar`: a horizontal, wrapping row above the note list showing a chip for
  each tag in `getKnownTags()` plus an **"untagged"** chip. Selected chips are
  highlighted (accent). Toggling updates state.
- **AND semantics** for multiple selected tags; **"untagged"** is mutually
  exclusive with tag selection (selecting it clears tag chips and vice-versa).
- **URL state:** selected tags reflected as `?tags=a,b` (comma-joined,
  URL-encoded); untagged as `?untagged=1`. `Home` reads these on mount and when
  they change (so a pill click elsewhere that navigates to `/?tags=x` selects
  that filter), and writes them when the user toggles chips.
- **Composition:** the visible list = `filterByTags(filterNotes(notes, query),
  selected, untaggedOnly)` — tag filter and the existing text search stack.

### 7. Premium hook — `entitlements.ts`

- `isPremium(): boolean` → `false` (stub). Single source of truth so wiring a
  real entitlement later is one change.
- `FREE_TAG_LIMIT` lives in `tags.ts` (imported where needed).

## Affected files

**New:**
- `frontend/src/tags.ts` — `normalizeTag`, `normalizeTags`, `filterByTags`, `FREE_TAG_LIMIT`
- `frontend/src/tags.test.ts`
- `frontend/src/entitlements.ts` — `isPremium()`
- `frontend/src/TagInput.tsx` — chip input + autocomplete (+ `TagPills`)
- `frontend/src/TagBar.tsx` — filter bar

**Modified:**
- `frontend/src/api.ts` — `NotePayload.tags`; `encryptPayload(content, title?, tags?)`; `decrypt` reads `tags`; `createNote(content, tags?)`, `updateNote(id, content, title?, tags?)`; `getKnownTags()` + registry updates
- `frontend/src/types.ts` — `Note.tags`
- `frontend/src/Editor.tsx` — `initialTags`, tags state, `<TagInput>`, nudge, `onSubmit` passes tags
- `frontend/src/Home.tsx` — `<TagBar>`, combined filter, entry pills, pass tags on create
- `frontend/src/NoteDetail.tsx` — tag pills, pass tags on edit, `initialTags`
- `frontend/src/i18n/en.ts` — `tags` copy
- `frontend/src/App.css` — chip input, pills, tag bar styles

## Testing

- **`tags.test.ts`:**
  - `normalizeTag`: lowercases, strips leading `#`, trims, collapses whitespace, `''` for blank.
  - `normalizeTags`: dedupes, drops empties, preserves order.
  - `filterByTags`: AND across multiple tags; `untaggedOnly` returns only tag-less notes; empty selection returns all; untagged + selected precedence.
- **Build/lint/tests:** `npx vitest run` all green; `npm run build`; `npm run lint` clean (only the known `i18n/index.tsx` re-export warnings).
- **Manual:** create a note, add tags via the chip field with autocomplete;
  the note shows a pill row; the tag bar filters by AND and by "untagged";
  clicking a pill in detail filters the list; adding a 6th tag shows the
  non-blocking nudge but still saves.

## Future enhancements (out of scope)

- Stored tag registry: global rename/delete, tag colors, tags without notes.
- Hard-enforce `FREE_TAG_LIMIT` once subscriptions exist (`isPremium()` real).
- OR / AND toggle; saved filters.
- Hiding tags from the body is moot (tags aren't in the body in this model).
