# Zobrazení, editace a vlastní URL poznámek

**Datum:** 2026-07-10
**Status:** Schváleno

## Cíl

Každá uložená poznámka je adresovatelná vlastní URL (`/notes/{id}`), dá se
zobrazit jako vykreslený markdown, upravit a smazat. UX má být intuitivní a
jednoduché — master-detail, žádné modaly.

## Rozhodnutí

- **Master-detail s client-side routováním** (`react-router-dom`). Ne inline
  rozbalení, ne modal — protože poznámka má mít vlastní sdílitelnou URL.
- **URL = ID** (`/notes/{uuid}`). Žádné slugy: robustní, žádné kolize, změna
  názvu nerozbije odkaz.
- **Sdílený editor** pro vytváření i editaci (Write/Preview, auto-resize,
  Ctrl+Enter). Vyčlení se ze současného `App.tsx` do vlastní komponenty.
- **Editace = přepnutí detailu na editor** (toggle), ne samostatná routa.
- **Pozor `url` pole:** stávající `url` na modelu je *odkaz, kam poznámka
  ukazuje*, ne adresa poznámky. Zůstává beze změny; „vlastní URL" je routa.

## Architektura frontendu

Rozpad `App.tsx` do menších, samostatně srozumitelných jednotek:

- `src/api.ts` — tenké fetch helpery: `listNotes`, `getNote`, `createNote`,
  `updateNote`, `deleteNote`. Jedno místo pro `API_URL` a tvar požadavků.
- `src/Editor.tsx` — editor s Write/Preview, auto-resize a Ctrl+Enter.
  Props: `initialContent`, `submitLabel`, `saving`, `onSubmit(content)`,
  volitelně `onCancel`. Bez znalosti routování — čistě vstup → `onSubmit`.
- `src/Home.tsx` — routa `/`: editor pro novou poznámku + seznam. Položky
  seznamu jsou odkazy na `/notes/{id}`.
- `src/NoteDetail.tsx` — routa `/notes/:id`: načte poznámku, vykreslí markdown
  (`react-markdown` + `remark-gfm`), tlačítka **Edit** (přepne na `Editor`) a
  **Delete** (potvrzení → smazání → návrat na `/`).
- `src/App.tsx` — jen router (`/` a `/notes/:id`).

Chování editoru (auto-resize, Ctrl+Enter, fokus, náhled) se přesune beze změny
sémantiky, jen do znovupoužitelné komponenty.

## Backend (Azure Functions)

Nové routy v `function_app.py`, sdílený store `notes_store` (in-memory):

- `GET /notes/{id}` — vrátí jednu poznámku, nebo `404`.
- `PUT /notes/{id}` — přijme `{ content, url? }`, znovu odvodí `title` přes
  `extract_title`, aktualizuje `content`/`title`/`url` (zachová `id` a
  `created_at`), vrátí aktualizovanou poznámku; `404` když neexistuje;
  `400` při neplatných datech.
- `DELETE /notes/{id}` — smaže; `204` při úspěchu, `404` když neexistuje.

Pomocná funkce `find_note(notes_store, id) -> Note | None` (čistá, testovatelná).
CORS hlavičky `Access-Control-Allow-Origin: *` jako u stávajících rout.

## Deployment (Azure Static Web Apps)

Přidat `frontend/staticwebapp.config.json` s `navigationFallback` na
`/index.html` (s vyloučením `/api/*` a assetů), aby přímé odkazy a refresh na
`/notes/{id}` vracely SPA místo 404.

## Testy

- **Backend (pytest):** `find_note` (nález / nenález), a logika update
  (změna obsahu → nový `title`, zachování `id`/`created_at`).
- **Frontend:** `tsc`, `oxlint`, `vite build`; interakce ověřit v prohlížeči.

## Mimo rozsah

- Perzistence (stále in-memory store).
- Autentizace / více uživatelů.
- Slugy, historie verzí, řazení/filtrování seznamu.
