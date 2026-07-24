# Cost Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Cosmos DB spend before promoting the app by adding three input/limit guards in `api/`.

**Architecture:** Three independent changes: (1) per-note size cap via Pydantic `max_length` on `NoteCreate`; (2) a per-account note-count ceiling enforced in `create_note`, with the decision extracted into a pure, unit-tested classifier; (3) rate-limiting two unauthenticated Cosmos-reading endpoints by reusing the existing `_rate_limited` guard.

**Tech Stack:** Python 3.12, Azure Functions (v2 decorator model), Pydantic, pytest.

## Global Constraints

- Use the `.venv` in `api/`. Run tests with `.venv/bin/python -m pytest` from `api/`.
- Tests run in plain Python and test **units** (models, repos, pure functions), never the `@app.route`-decorated HTTP handlers — those are wrapped in a non-callable `FunctionBuilder` and calling into `auth` requires `SESSION_SIGNING_KEY`. Follow this convention; do not add HTTP-handler tests.
- Baseline before starting: `54 passed`.
- Limits (verbatim from spec): note `ct` max **65536** chars; note `iv` max **64** chars; unverified account cap **10** notes; verified account cap **1000** notes; shared auth rate limit **20 calls / 60 s** per IP.
- Comments and copy in English; no hardcoded user-facing strings beyond the existing error-message style already in `function_app.py`.

---

### Task 1: Per-note size limit

**Files:**
- Modify: `api/models.py:24-28` (`NoteCreate`)
- Test: `api/test_notes.py` (create)

**Interfaces:**
- Produces: `NoteCreate(iv: str, ct: str, created_at: Optional[datetime])` now rejects `iv` longer than 64 chars or `ct` longer than 65536 chars with `pydantic.ValidationError`. Both `create_note` and `update_note` already parse `NoteCreate`, so the cap covers create and update. No handler change needed — the existing `except` returns `400 Invalid data`.

- [ ] **Step 1: Write the failing tests**

Create `api/test_notes.py`:

```python
import pytest
from pydantic import ValidationError

from models import NoteCreate


def test_note_accepts_a_normal_payload():
    note = NoteCreate(iv="x" * 16, ct="c" * 100)
    assert note.iv == "x" * 16
    assert len(note.ct) == 100


def test_note_accepts_ciphertext_exactly_at_the_limit():
    assert len(NoteCreate(iv="x" * 16, ct="c" * 65536).ct) == 65536


def test_note_rejects_ciphertext_over_the_limit():
    with pytest.raises(ValidationError):
        NoteCreate(iv="x" * 16, ct="c" * 65537)


def test_note_rejects_an_oversized_iv():
    with pytest.raises(ValidationError):
        NoteCreate(iv="x" * 65, ct="c" * 10)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest test_notes.py -q`
Expected: `test_note_rejects_ciphertext_over_the_limit` and `test_note_rejects_an_oversized_iv` FAIL (no `ValidationError` raised — currently unbounded).

- [ ] **Step 3: Add the length caps**

In `api/models.py`, change `NoteCreate` (currently):

```python
class NoteCreate(BaseModel):
    iv: str
    ct: str
    # Optional: preserve an original timestamp on import; otherwise server-set.
    created_at: Optional[datetime] = None
```

to:

```python
class NoteCreate(BaseModel):
    # Length caps bound per-note Cosmos storage/RU. ct is Base64 ciphertext:
    # 65536 chars ~= 48 KB encrypted ~= ~45 KB plaintext. iv is a 12-byte nonce
    # (~16 chars); 64 is headroom.
    iv: str = Field(max_length=64)
    ct: str = Field(max_length=65536)
    # Optional: preserve an original timestamp on import; otherwise server-set.
    created_at: Optional[datetime] = None
```

(`Field` is already imported at the top of `models.py`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest test_notes.py -q`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add api/models.py api/test_notes.py
git commit -m "feat(api): cap note ciphertext and iv size

Bounds per-note Cosmos storage/RU: ct <= 65536 chars, iv <= 64 chars.
Covers create and update (both parse NoteCreate).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Per-account note cap

**Files:**
- Modify: `api/function_app.py:22` (constants), `api/function_app.py:353-384` (`create_note`)
- Test: `api/test_notes.py` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_note_limit_hit(count: int, verified: bool) -> Optional[str]` returning `"unverified"`, `"hard"`, or `None`. `create_note` uses it to gate note creation.

- [ ] **Step 1: Write the failing tests**

Append to `api/test_notes.py`:

```python
import function_app as fa


def test_no_limit_hit_for_a_fresh_account():
    assert fa._note_limit_hit(0, verified=True) is None
    assert fa._note_limit_hit(0, verified=False) is None


def test_unverified_account_capped_at_ten():
    assert fa._note_limit_hit(9, verified=False) is None
    assert fa._note_limit_hit(10, verified=False) == "unverified"


def test_verified_account_allowed_past_the_unverified_cap():
    assert fa._note_limit_hit(500, verified=True) is None


def test_verified_account_capped_at_one_thousand():
    assert fa._note_limit_hit(999, verified=True) is None
    assert fa._note_limit_hit(1000, verified=True) == "hard"
```

(Importing `function_app` at module top is safe — it does not require `SESSION_SIGNING_KEY`; only calling into `auth` does, which `_note_limit_hit` never does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest test_notes.py -q`
Expected: FAIL with `AttributeError: module 'function_app' has no attribute '_note_limit_hit'`.

- [ ] **Step 3: Add the constant and the classifier**

In `api/function_app.py`, next to the existing constant on line 22:

```python
_UNVERIFIED_NOTE_LIMIT = 10  # unverified accounts may have at most this many notes
```

add below it:

```python
_VERIFIED_NOTE_LIMIT = 1000  # hard per-account ceiling (bounds Cosmos storage/RU)
```

Then add this function above the notes routes (e.g. just before `# ---- notes` around line 343):

```python
def _note_limit_hit(count: int, verified: bool) -> Optional[str]:
    """Which cap creating one more note would breach: 'unverified', 'hard', or None."""
    if not verified and count >= _UNVERIFIED_NOTE_LIMIT:
        return "unverified"
    if count >= _VERIFIED_NOTE_LIMIT:
        return "hard"
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest test_notes.py -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Wire the classifier into `create_note`**

In `api/function_app.py`, replace the existing soft-gate block in `create_note` (currently):

```python
    # Soft-gate: an unverified account has a cap on the number of notes (a brake against bots).
    account = users_repo.get_user(user)
    if (
        account is not None
        and not account.email_verified
        and notes_repo.count_notes(user) >= _UNVERIFIED_NOTE_LIMIT
    ):
        _maybe_send_verification(account)
        return _error(
            f"Verify your e-mail for more than {_UNVERIFIED_NOTE_LIMIT} notes.", 403
        )
```

with:

```python
    # Note caps: unverified accounts get a low bot-brake ceiling; every account
    # has a hard ceiling that bounds per-account Cosmos storage/RU.
    account = users_repo.get_user(user)
    verified = account.email_verified if account is not None else False
    hit = _note_limit_hit(notes_repo.count_notes(user), verified)
    if hit == "unverified":
        if account is not None:
            _maybe_send_verification(account)
        return _error(
            f"Verify your e-mail for more than {_UNVERIFIED_NOTE_LIMIT} notes.", 403
        )
    if hit == "hard":
        return _error("Note limit reached", 403)
```

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass (baseline 54 + 8 new = 62 passed).

- [ ] **Step 7: Commit**

```bash
git add api/function_app.py api/test_notes.py
git commit -m "feat(api): cap notes per account

Adds a 1000-note hard ceiling for every account (unverified stays at 10)
via a pure _note_limit_hit classifier, bounding per-account Cosmos growth.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rate-limit the unauthenticated Cosmos-reading endpoints

**Files:**
- Modify: `api/function_app.py:163-169` (`get_salt`), `api/function_app.py:249-258` (`recovery_material`)

**Interfaces:**
- Consumes: existing `_rate_limited(req) -> Optional[func.HttpResponse]` (returns a `429` response when the shared `_auth_limiter` denies the caller's IP, else `None`).
- Produces: `auth/salt` and `auth/recovery-material` now consult the shared limiter, closing an unauthenticated Cosmos-RU amplification vector.

**No new automated test.** This is endpoint-limiter wiring. The suite does not test `@app.route` handlers (FunctionBuilder-wrapped, `SESSION_SIGNING_KEY`-dependent), exactly as the existing `feedback` and other auth endpoints have no handler test — the limiter itself is covered by `test_ratelimit.py`. Verification here is code inspection plus a green full-suite run.

- [ ] **Step 1: Add the guard to `get_salt`**

In `api/function_app.py`, `get_salt` currently is:

```python
@app.route(route="auth/salt", methods=["GET"])
def get_salt(req: func.HttpRequest) -> func.HttpResponse:
    username = req.params.get("username", "")
```

Insert the guard as the first statements in the body:

```python
@app.route(route="auth/salt", methods=["GET"])
def get_salt(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
```

- [ ] **Step 2: Add the guard to `recovery_material`**

In `api/function_app.py`, `recovery_material` currently is:

```python
@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    user = users_repo.get_user(req.params.get("username", ""))
```

Insert the guard as the first statements in the body:

```python
@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    user = users_repo.get_user(req.params.get("username", ""))
```

- [ ] **Step 3: Inspect the change**

Run: `git diff api/function_app.py`
Expected: both handlers now begin with the three-line `_rate_limited` guard, matching the pattern already used by `pow_challenge`, `register`, `login`, `verify_email`, `send_verification`, and `recover`.

- [ ] **Step 4: Run the full suite to confirm no regression**

Run: `.venv/bin/python -m pytest -q`
Expected: `62 passed` (no new tests; nothing broken).

- [ ] **Step 5: Commit**

```bash
git add api/function_app.py
git commit -m "feat(api): rate-limit salt and recovery-material endpoints

Both do an unauthenticated Cosmos read per call; without a limiter they were
an RU-amplification vector. Reuses the shared _auth_limiter guard.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- Do not add `maxScaleOutCount`/`functionAppScaleLimit` — not configurable on SWA managed API; it would be a no-op. (See spec "Mimo scope".)
- The in-memory rate limiter is per-instance and best-effort — a documented existing trade-off; this plan does not change it.
