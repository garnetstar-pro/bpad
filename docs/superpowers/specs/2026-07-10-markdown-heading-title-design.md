# Markdown heading → note title

**Date:** 2026-07-10
**Status:** Approved

## Goal

Notes are written as Markdown. On save, the backend extracts the note's first
heading and stores it as the note's `title`. The entries list displays **only**
the title; the full Markdown body is preserved but not shown in the list.

## Decisions

- **Keep full body, show only title.** The full Markdown is stored in `content`
  (unchanged). A new `title` field holds the extracted heading. The list renders
  the title only.
- **Extraction happens in the backend** (Python Functions API). The client sends
  raw Markdown; the API derives the title. The API remains the authoritative
  source of the stored shape.
- **No-heading fallback:** if the Markdown contains no heading, the title is the
  first non-empty line of the text, trimmed.
- **Mechanism: regex**, not a Markdown library. No new dependency; matches the
  app's minimal footprint and the spec's own recommendation.
- **Raw heading text** is kept as-is. Inline formatting such as
  `# My **Awesome** Note` is stored verbatim (`My **Awesome** Note`); no
  emphasis-stripping. YAGNI until rendered titles are actually needed.

## Design

### Data model — `api/models.py`

Add a server-set `title` to the stored `Note`. `NoteCreate` is unchanged: the
client never sends a title.

```python
class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str            # NEW — derived from content by the backend
    content: str          # full markdown, preserved
    url: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class NoteCreate(BaseModel):
    content: str
    url: Optional[str] = None
```

### Extraction helper — `extract_title(content: str) -> str`

A standalone pure function (independently testable), in `api/`.

Rules, in order:
1. Scan lines top-to-bottom. Return the text of the **first ATX heading**
   (`#` through `######` followed by whitespace), with leading `#`s and any
   trailing closing `#`s stripped, then trimmed.
2. Otherwise return the **first non-empty line**, trimmed.
3. If the input is empty/whitespace only, return `(bez názvu)` as a final guard.
   (The UI already blocks empty saves, so this is defensive.)

Heading match (per line): `^\s*#{1,6}\s+(.*?)\s*#*\s*$`.

### API wiring — `api/function_app.py`

In `create_note`, after validating `NoteCreate`:

```python
title = extract_title(note_data.content)
new_note = Note(title=title, content=note_data.content, url=note_data.url)
```

`GET /api/notes` returns `title` automatically (part of the model). No route or
response-shape changes beyond the added field.

### Frontend — `frontend/src/App.tsx`

- Add `title: string` to the `Note` interface.
- Render `note.title` in `.entry-title` (currently renders `note.content`).
- No other changes: textarea, "File it" button, focus-after-save, and the POST
  body `{ content: draft }` all stay as-is.

## Testing

Add `pytest` tests for `extract_title` (bootstraps `api/` tests — none exist
yet). Cases:
- H1 heading on the first line.
- First heading is a deeper level (e.g. `##`).
- Heading appears after some body text (not on line 1).
- No heading → first non-empty line used.
- Empty / whitespace-only input → `(bez názvu)`.
- Heading with inline formatting kept verbatim.
- ATX heading with a trailing closing `#` sequence stripped.

## Out of scope

- Rendering Markdown (bold/links) in the UI.
- Editing or deleting notes.
- Persisting notes beyond the in-memory store.
