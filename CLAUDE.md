# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`bpad` is a personal note-capture app deployed as an **Azure Static Web App**: a React/Vite frontend (`frontend/`) served statically, backed by an Azure Functions Python API (`api/`). Azure SWA routes requests under `/api/*` to the Functions app automatically, so the two pieces are deployed together as one unit.

User-facing copy is **English**, delivered via the `t()` i18n layer (`frontend/src/i18n/`) — never hardcode user-facing strings in components. Code comments and logs are **English**. Adding a language means adding a sibling dictionary in `frontend/src/i18n/` (see `en.ts`) and registering it in `index.tsx`'s `LOCALES`.

## Commands

### Frontend (`cd frontend`)
- `npm run dev` — Vite dev server (expects the API at `http://localhost:7071`)
- `npm run build` — type-check (`tsc -b`) then production build to `frontend/dist`
- `npm run lint` — oxlint
- `npm run preview` — serve the production build locally

### API (`cd api`)
- `func start` — run the Functions host locally on port **7071** (Azure Functions Core Tools). The frontend dev build hardcodes this URL.
- Dependencies: `pip install -r requirements.txt` (a `.venv` already exists in `api/`)
- Python 3.12.

There is no test suite or root-level build; each part builds independently and CI wires them together.

## Architecture

**Data flow:** `frontend/src/App.tsx` is a single-component app that GETs/POSTs notes to the API. `api/function_app.py` defines two routes (`GET /api/notes`, `POST /api/notes`) on a `FunctionApp`. Note shapes are validated with Pydantic models in `api/models.py` (`Note` = stored shape with server-generated `id`/`created_at`; `NoteCreate` = accepted POST body).

**Storage is in-memory and ephemeral:** `notes_store` is a module-level Python list in `function_app.py`. Notes are lost on every function restart/redeploy and are not shared across instances. Any persistence work means introducing a real datastore here.

**API base URL** is environment-switched in `App.tsx`: `import.meta.env.DEV` → `http://localhost:7071/api/notes`, otherwise the relative `/api/notes` (served by SWA in production). The API also sets permissive `Access-Control-Allow-Origin: *` CORS headers on every response for local cross-port dev.

**Deployment:** `.github/workflows/azure-static-web-apps-*.yml` builds and deploys on push to `master` (and manages preview environments for PRs) via `Azure/static-web-apps-deploy`. Build config: `app_location: /frontend`, `api_location: api`, `output_location: dist`.

## Notes

- The root `index.html` is a leftover deployment-pipeline smoke-test page, **not** the app. The real app entry is `frontend/index.html` → `frontend/src/main.tsx`.
