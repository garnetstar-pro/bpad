# bpad

Personal, **end-to-end encrypted** note-capture app. A React/Vite frontend
(`frontend/`) backed by an Azure Functions Python API (`api/`), deployed together
as one Azure Static Web App. Note contents are encrypted in the browser — the
server only ever stores ciphertext.

## Running locally

The app is two processes: the API on port **7071** and the frontend on port
**5173**. Run each in its own terminal. The dev frontend has the API URL
(`http://localhost:7071`) hardcoded, so the ports matter.

### 1. API (`api/`, port 7071)

Requires Python 3.12 and [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`).

First-time setup:

```bash
cd api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Every run:

```bash
cd api
source .venv/bin/activate
func start
```

**Activate the venv first.** `func` resolves its Python worker from `PATH`, so a
bare `func start` picks up the system interpreter and dies with
`ModuleNotFoundError: No module named 'pydantic'` followed by "No job functions
found". Prefixing with `.venv/bin/python -m …` does not help — the worker is a
separate process.

Handy variants:

- `POW_DIFFICULTY=0 func start` — disables the registration proof-of-work, so you
  can register test accounts instantly (including via `curl`).
- If you see `Port 7071 is unavailable`, another `func` is already running — reuse
  it, or `kill` it and start again.

Without `COSMOS_CONNECTION_STRING` the API uses in-memory storage: everything is
lost when you stop `func start`. That is fine for local UI work. In dev mode the
Core Tools set `AZURE_FUNCTIONS_ENVIRONMENT=Development`, so the API falls back to
a known insecure `SESSION_SIGNING_KEY` — you don't need to set one locally.

See `api/local.settings.json` (gitignored) to configure Cosmos, email, etc. The
full list of variables is in [CLAUDE.md](CLAUDE.md#environment-variables).

### 2. Frontend (`frontend/`, port 5173)

Requires Node.js.

First-time setup:

```bash
cd frontend
npm install
```

Every run:

```bash
cd frontend
npm run dev
```

Then open http://localhost:5173.

> Common mistake: running `npm run dev` in `api/`. That directory is the Python
> API and has no `package.json` — all `npm` commands belong in `frontend/`.

## Other commands

From `frontend/`:

- `npm run build` — type-check (`tsc -b`) then production build to `frontend/dist`
- `npm run test` — unit tests (vitest)
- `npm run lint` — oxlint
- `npm run preview` — serve the production build locally

From `api/` (venv activated):

- `python -m pytest` — API test suite

## More

Architecture, environment variables, and design notes live in
[CLAUDE.md](CLAUDE.md). Design docs are under `docs/superpowers/`.
