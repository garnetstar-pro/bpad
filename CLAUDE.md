# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`bpad` is a personal, **end-to-end encrypted** note-capture app deployed as an **Azure Static Web App**: a React/Vite frontend (`frontend/`) served statically, backed by an Azure Functions Python API (`api/`). Azure SWA routes requests under `/api/*` to the Functions app automatically, so the two pieces are deployed together as one unit.

The server is a **zero-knowledge** store: note contents are encrypted in the browser and the API only ever sees ciphertext (`iv`/`ct`). Anything that would require the server to read note contents is off the table by design.

User-facing copy is **English**, delivered via the `t()` i18n layer (`frontend/src/i18n/`) — never hardcode user-facing strings in components. Code comments and logs are **English**; design docs under `docs/` are Czech. Adding a language means adding a sibling dictionary next to `i18n/en.ts`, then widening both the `Locale` union and the `LOCALES` record in **`i18n/translate.ts`** (the React-free core; `index.tsx` only holds the hook/provider). The language switcher is already built and stays hidden while only one locale is registered.

## Commands

### Frontend (`cd frontend`)
- `npm run dev` — Vite dev server (expects the API at `http://localhost:7071`)
- `npm run build` — type-check (`tsc -b`) then production build to `frontend/dist`
- `npm run test` — vitest (unit tests live beside sources as `*.test.ts`)
- `npm run lint` — oxlint
- `npm run preview` — serve the production build locally

### API (`cd api`)
- `source .venv/bin/activate && func start` — run the Functions host locally on port **7071** (Azure Functions Core Tools). The frontend dev build hardcodes this URL. **The venv must be activated first**: `func` resolves its Python worker from `PATH`, so a bare `func start` picks up the system interpreter and dies with `ModuleNotFoundError: No module named 'pydantic'` followed by "No job functions found". Prefixing the command (`.venv/bin/python -m ...`) does not help — the worker is a separate process.
- `POW_DIFFICULTY=0 func start` disables registration proof-of-work, which makes it possible to register a test account with dummy values via `curl`.
- `python -m pytest` — test suite (`test_*.py` beside the sources)
- Dependencies: `pip install -r requirements-dev.txt` (runtime deps only: `requirements.txt`)
- Python 3.12. **Use the `.venv` in `api/`** — it has the dependencies installed. (A stray empty `api/venv/` also exists; both are gitignored, but `venv/` is not the one you want.)

There is no root-level build; each part builds independently and CI wires them together.

## Architecture

**Auth is custom and password-derived.** `api/auth.py` issues **JWT (HS256)** session tokens signed with `SESSION_SIGNING_KEY`; without it the API fails closed everywhere except a local dev host (`AZURE_FUNCTIONS_ENVIRONMENT == "Development"`, which falls back to a known insecure key). The client never sends the password: `frontend/src/crypto.ts` derives keys with **Argon2id** (`hash-wasm`) + HKDF + AES-256-GCM and sends only an auth verifier, which the server stores PBKDF2-hashed. Registration is throttled by stateless proof-of-work (`api/pow.py`, HMAC-signed challenge bound to a username, difficulty via `POW_DIFFICULTY`, `0` disables it for tests). Optional biometric unlock uses WebAuthn PRF (`frontend/src/biometric.ts`).

**Routes** (`api/function_app.py`, ~16 of them): `auth/*` covers pow-challenge, register, salt, login, verify-email, send-verification, recovery-material, recover, change-password, me, preferences; `notes` and `notes/{id}` cover CRUD. Request/response shapes are Pydantic models in `api/models.py`.

**Storage is Azure Cosmos DB** via `api/repository.py`, which is the pattern to follow for any new persisted type: a `Protocol` interface + an `InMemory*` implementation (fallback when `COSMOS_CONNECTION_STRING` is unset; used by tests) + a `Cosmos*` implementation + a `get_*_repository()` factory. Containers: `notes` (partition `/user_id`), `users` (`/username`), `email_index` (`/id`, enforces email uniqueness via atomic create), `feedback` (`/user_id`, write-only from the app — read it in the portal's Data Explorer). The Cosmos account is **serverless**, so extra containers cost nothing fixed — don't cram new document types into an existing container to save money.

**Backups** (`frontend/src/backup.ts`) let the user export every note to a file and read it back on `/restore` without an account — the cover for losing both the password and the recovery code. The file is JSON: either `{ format, version, exported_at, username, encrypted: false, notes: [...] }`, or the same header with `encrypted: true` plus `kdf` (Argon2id parameters and salt), `iv` and `ct`, where the ciphertext is AES-256-GCM over the JSON `{ "notes": [...] }`. The key is Argon2id over the backup passphrase used **directly** — no HKDF, unlike the login path — and the KDF parameters travel in the file so raising them never orphans an old backup. `backup.ts` stays pure (no UI, no network); `backupFile.ts` does the download/read, `backupImport.ts` the sequential restore through `createNote()`. `/restore` is routed **before** the auth check in `App.tsx`, since a locked-out visitor is exactly who needs it. Format described in `docs/superpowers/specs/2026-07-20-backup-export-import-design.md`.

**Email** goes through Azure Communication Services (`api/mailer.py`, resource `bpad-comms`). Note it is deliberately **best-effort**: send failures are caught and logged, never raised. That is right for verification mail (the account exists regardless) but means email must never be the only record of something you cannot afford to lose.

**Rate limiting** (`api/ratelimit.py`) is an in-memory sliding window — per-instance and therefore only approximate on serverless. It is a brake against runaway clients, not a defence against a determined attacker; a hard limit belongs at the infra layer.

**Frontend** is routed with react-router (`App.tsx`): unauthenticated visitors get `Landing`/`AuthGate`, authenticated users get `Home`, `NoteDetail`, `Account`, `Features`. The catch-all route is `Capture`, which turns a URL pasted into the address bar (`dev.bpad.pro/https://example.com`) into a new note and redirects to it. `api.ts` and `authApi.ts` talk to the API; both switch base URL on `import.meta.env.DEV` (`http://localhost:7071/api/...` vs relative `/api/...`). Notes are cached for offline read in `offlineCache.ts`.

**SWA gotcha:** Static Web Apps does **not** forward the `Authorization` header to managed functions, so the session token is sent in a custom **`X-Auth-Token`** header (`Authorization: Bearer` remains a fallback for direct API calls). The API also sets `Access-Control-Allow-Origin` (`ALLOWED_ORIGIN`, `*` in dev) on every response.

**PWA:** `vite-plugin-pwa` generates the manifest and service worker from `frontend/vite.config.ts` (`registerType: 'prompt'` — the update is user-confirmed via `UpdatePrompt.tsx`, not silent). Icons are generated from `frontend/scripts/icon-master.png` by `scripts/generate-icons.py`; `scripts/check-icons.py` validates the built manifest after `npm run build`. Note `any` and `maskable` icons are **separate files on purpose** — Android crops maskable icons to a launcher shape and only the centred 80%-diameter circle survives, so one file cannot serve both roles.

**Deployment:** `.github/workflows/azure-static-web-apps-*.yml` builds and deploys on push to `master` (and manages preview environments for PRs) via `Azure/static-web-apps-deploy`. Build config: `app_location: /frontend`, `api_location: api`, `output_location: dist`.

## Environment variables

| Variable | Purpose |
|---|---|
| `SESSION_SIGNING_KEY` | Signs session tokens. **Required** — API fails closed in production without it. |
| `COSMOS_CONNECTION_STRING` | Cosmos DB. Unset → in-memory repositories (data lost on restart). |
| `ACS_CONNECTION_STRING`, `EMAIL_SENDER` | Azure Communication Services email. Unset → the link is only logged. |
| `APP_BASE_URL` | Base for links in emails (default `http://localhost:5173`). |
| `POW_DIFFICULTY` | Registration proof-of-work leading zero bits (default `20`, `0` disables). |
| `FEEDBACK_EMAIL` | Recipient of feedback notifications. Unset → the message is only logged (it is still stored). |
| `ALLOWED_ORIGIN` | CORS origin (default `*`). |

## Notes

- **Design docs live in `docs/superpowers/specs/`** (and plans in `docs/superpowers/plans/`), written in Czech. Read the relevant spec before changing a feature it covers.
- The root `index.html` is a leftover deployment-pipeline smoke-test page, **not** the app. The real app entry is `frontend/index.html` → `frontend/src/main.tsx`.
