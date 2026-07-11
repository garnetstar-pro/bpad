# Proof-of-work Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mass account creation linearly expensive via a stateless proof-of-work challenge on registration, and stop sending verification e-mail until an account shows human intent.

**Architecture:** The server issues an HMAC-signed, username-bound PoW challenge (no DB). The browser solves it (SHA-256 leading-zero-bits search in a Web Worker) and submits the nonce with the registration. Registration verifies the PoW before any expensive work and no longer sends e-mail; the verification e-mail is instead sent when an unverified account first hits the 10-note soft-gate (plus the existing resend button).

**Tech Stack:** Python 3.12 / Azure Functions (v2), Pydantic; React 19 / Vite 8 / TypeScript, hash-wasm, vitest; pytest.

## Global Constraints

- Python 3.12; Azure Functions v2 model (`@app.route`). Backend deps already include `azure-functions`, `pydantic`, `pyjwt`; **no new backend dependency**.
- Frontend: React 19 / TS; **no new frontend dependency** — reuse `hash-wasm` (already imported in `frontend/src/crypto.ts`).
- User-facing and log strings are **Czech** (matching existing files).
- PoW secret is derived from the existing `SESSION_SIGNING_KEY`; **no new secret to provision**.
- `POW_DIFFICULTY` env var, default `20`; `0` disables PoW entirely.
- PoW challenge TTL: `120` seconds. Enforced difficulty comes from the **signed payload**, not current env, so a mid-flight env change can't weaken an outstanding challenge.
- Every backend response keeps the existing `_CORS` headers via the `_json`/`_error` helpers.
- Commit after every task with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` as the trailer.

## File Structure

| File | Responsibility |
|---|---|
| `api/pow.py` *(new)* | Issue & verify stateless PoW challenges; leading-zero-bit helper |
| `api/test_pow.py` *(new)* | Unit tests for `pow.py` |
| `api/conftest.py` *(modify)* | Default `POW_DIFFICULTY=0` for tests |
| `api/models.py` *(modify)* | `RegisterRequest` gains `powChallenge`, `powNonce` |
| `api/function_app.py` *(modify)* | `GET /auth/pow-challenge`; PoW gate in `register`; drop registration e-mail; auto-send in `create_note` |
| `frontend/src/pow.ts` *(new)* | `countLeadingZeroBits`, `findNonce`, `solvePow` (Worker wrapper) |
| `frontend/src/powWorker.ts` *(new)* | Web Worker entry calling `findNonce` |
| `frontend/src/pow.test.ts` *(new)* | Unit tests for the solver core |
| `frontend/src/authApi.ts` *(modify)* | Fetch challenge, solve, attach to register |
| `frontend/src/AuthGate.tsx` *(modify)* | "ověřuji, že nejsi robot…" state while solving |

---

## Task 1: Backend PoW module (`api/pow.py`)

**Files:**
- Create: `api/pow.py`
- Create: `api/test_pow.py`
- Modify: `api/conftest.py`

**Interfaces:**
- Consumes: `auth._signing_key()` from `api/auth.py`.
- Produces:
  - `pow.issue_challenge(username: str) -> dict` → `{"challenge": str, "difficulty": int}`
  - `pow.verify_solution(challenge: str, nonce: str, username: str) -> bool`
  - `pow.count_leading_zero_bits(digest: bytes) -> int`

- [ ] **Step 1: Write the failing tests**

Create `api/test_pow.py`:

```python
import hashlib
import time

import pow


def _solve(challenge: str, difficulty: int) -> str:
    """Brute-force a nonce for a low difficulty (test helper)."""
    nonce = 0
    while True:
        digest = hashlib.sha256((challenge + str(nonce)).encode()).digest()
        if pow.count_leading_zero_bits(digest) >= difficulty:
            return str(nonce)
        nonce += 1


def test_count_leading_zero_bits():
    assert pow.count_leading_zero_bits(bytes([0xFF])) == 0
    assert pow.count_leading_zero_bits(bytes([0x00, 0xFF])) == 8
    assert pow.count_leading_zero_bits(bytes([0x0F])) == 4
    assert pow.count_leading_zero_bits(bytes([0x00, 0x00])) == 16


def test_valid_solution_verifies(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "8")
    issued = pow.issue_challenge("alice")
    assert issued["difficulty"] == 8
    nonce = _solve(issued["challenge"], 8)
    assert pow.verify_solution(issued["challenge"], nonce, "alice") is True


def test_wrong_nonce_fails(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "8")
    issued = pow.issue_challenge("alice")
    assert pow.verify_solution(issued["challenge"], "definitely-not-it", "alice") is False


def test_tampered_challenge_fails(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "8")
    issued = pow.issue_challenge("alice")
    nonce = _solve(issued["challenge"], 8)
    payload, _sig = issued["challenge"].split(".", 1)
    forged = payload + ".AAAA"  # bad signature
    assert pow.verify_solution(forged, nonce, "alice") is False


def test_challenge_bound_to_username(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "8")
    issued = pow.issue_challenge("alice")
    nonce = _solve(issued["challenge"], 8)
    # same solved challenge, different username → rejected
    assert pow.verify_solution(issued["challenge"], nonce, "bob") is False


def test_expired_challenge_fails(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "8")
    issued = pow.issue_challenge("alice")
    nonce = _solve(issued["challenge"], 8)
    real_now = time.time()
    # jump the clock past the 120 s TTL
    monkeypatch.setattr(time, "time", lambda: real_now + 200)
    assert pow.verify_solution(issued["challenge"], nonce, "alice") is False


def test_difficulty_zero_disables(monkeypatch):
    monkeypatch.setenv("POW_DIFFICULTY", "0")
    issued = pow.issue_challenge("alice")
    assert issued["difficulty"] == 0
    # any nonce accepted when disabled
    assert pow.verify_solution(issued["challenge"], "whatever", "alice") is True
```

Note: the expiry test replaces `time.time` with a lambda returning a far-future constant, which is simpler and robust — the `__wrapped__` guard is defensive; if it reads awkwardly, just use `monkeypatch.setattr(time, "time", lambda: 1e12)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && source .venv/bin/activate && python -m pytest test_pow.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pow'`.

- [ ] **Step 3: Write `api/pow.py`**

```python
"""Stateless proof-of-work for registration (anti-bot brake).

The server issues an HMAC-signed challenge bound to a username; the client
finds a nonce whose SHA-256(challenge+nonce) has enough leading zero bits.
No datastore: replay is neutralised by binding to the username (which is
consumed on a successful registration) plus a short TTL.
"""
import base64
import hashlib
import hmac
import json
import os
import time

import auth

_POW_TTL = 120  # s – okno platnosti výzvy
_CLOCK_SKEW = 60  # s – tolerance dopředu


def _difficulty() -> int:
    try:
        return int(os.environ.get("POW_DIFFICULTY", "20"))
    except ValueError:
        return 20


def _secret() -> bytes:
    # Doménová separace od podepisování session tokenů.
    return hmac.new(auth._signing_key().encode(), b"pow", hashlib.sha256).digest()


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload_b64: str, username: str) -> str:
    mac = hmac.new(_secret(), f"{payload_b64}|{username}".encode(), hashlib.sha256).digest()
    return _b64u(mac)


def count_leading_zero_bits(digest: bytes) -> int:
    bits = 0
    for byte in digest:
        if byte == 0:
            bits += 8
            continue
        bits += 8 - byte.bit_length()
        break
    return bits


def issue_challenge(username: str) -> dict:
    difficulty = _difficulty()
    payload = {"ts": int(time.time()), "rand": _b64u(os.urandom(16)), "difficulty": difficulty}
    payload_b64 = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    challenge = f"{payload_b64}.{_sign(payload_b64, username)}"
    return {"challenge": challenge, "difficulty": difficulty}


def verify_solution(challenge: str, nonce: str, username: str) -> bool:
    if _difficulty() == 0:
        return True  # PoW vypnutý (lokál/testy)
    try:
        payload_b64, sig = challenge.split(".", 1)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(payload_b64, username)):
        return False
    try:
        payload = json.loads(_unb64u(payload_b64))
        ts = int(payload["ts"])
        difficulty = int(payload["difficulty"])
    except (ValueError, KeyError, TypeError):
        return False
    now = time.time()
    if now - ts > _POW_TTL or ts > now + _CLOCK_SKEW:
        return False
    digest = hashlib.sha256(f"{challenge}{nonce}".encode()).digest()
    return count_leading_zero_bits(digest) >= difficulty
```

- [ ] **Step 4: Add the test default to `api/conftest.py`**

Append after the existing `SESSION_SIGNING_KEY` line:

```python
# PoW vypnutý v testech, pokud si test nenastaví vlastní obtížnost.
os.environ.setdefault("POW_DIFFICULTY", "0")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && source .venv/bin/activate && python -m pytest test_pow.py -v`
Expected: PASS (7 tests). Then run the whole backend suite:
Run: `python -m pytest -q`
Expected: all previous tests still pass (26) plus the new ones.

- [ ] **Step 6: Commit**

```bash
git add api/pow.py api/test_pow.py api/conftest.py
git commit -m "$(cat <<'EOF'
Add stateless proof-of-work module for registration

HMAC-signed, username-bound challenge with a leading-zero-bits SHA-256
target and a 120s TTL. No datastore: replay is neutralised by binding to
the username (consumed on successful registration). POW_DIFFICULTY=0
disables it for local/dev/tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Gate registration with PoW

**Files:**
- Modify: `api/models.py` (`RegisterRequest`)
- Modify: `api/function_app.py` (import `pow`; new `pow-challenge` route; PoW check in `register`)

**Interfaces:**
- Consumes: `pow.issue_challenge`, `pow.verify_solution` from Task 1.
- Produces: `GET /api/auth/pow-challenge?username=X` → `{challenge, difficulty}`; `POST /api/auth/register` now requires `powChallenge` and `powNonce` fields.

- [ ] **Step 1: Add fields to `RegisterRequest`**

In `api/models.py`, extend `RegisterRequest` (add the two fields at the end of the class):

```python
class RegisterRequest(BaseModel):
    username: str
    email: str
    salt: str
    recoverySalt: str
    authVerifier: str
    recAuthVerifier: str
    wrappedDataKeyPw: Encrypted
    wrappedDataKeyRec: Encrypted
    powChallenge: str
    powNonce: str
```

- [ ] **Step 2: Import `pow` and add the challenge route in `function_app.py`**

Add `import pow` to the import block near `import auth` / `import mailer` (line ~16-17):

```python
import auth
import mailer
import pow
```

Add this route just above the `register` function (before line 89 `@app.route(route="auth/register"...`):

```python
@app.route(route="auth/pow-challenge", methods=["GET"])
def pow_challenge(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
    if not username.strip():
        return _error("Chybí uživatelské jméno", 400)
    return _json(pow.issue_challenge(username), 200)
```

- [ ] **Step 3: Add the PoW check inside `register`**

In `register`, immediately after the `if not data.username.strip():` block and **before** the `email = data.email.strip().lower()` line, insert:

```python
    if not pow.verify_solution(data.powChallenge, data.powNonce, data.username):
        return _error("Ověření proti robotům selhalo, zkus registraci znovu.", 403)
```

This runs before e-mail reservation and PBKDF2 hashing, so an unsolved request costs the server only one HMAC + one SHA-256.

- [ ] **Step 4: Live HTTP verification**

Run this script (in-memory func, PoW forced on at low difficulty so we can solve it in the shell):

```bash
SCRATCH="$(pwd)/../scratchpad-pow"; mkdir -p "$SCRATCH"
cd api && source .venv/bin/activate
POW_DIFFICULTY=12 func start --port 7086 > "$SCRATCH/f.log" 2>&1 &
for i in $(seq 1 30); do grep -qE "http://localhost:7086/api" "$SCRATCH/f.log" && break; sleep 1; done
A=http://localhost:7086/api; WK='{"iv":"aXY=","ct":"Y3Q="}'
python3 - "$A" <<'PY'
import sys, json, hashlib, urllib.request
A = sys.argv[1]
def get(u): return json.load(urllib.request.urlopen(u))
def post(u, body):
    r = urllib.request.Request(u, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(r)  # otevři jen jednou (POST se nesmí opakovat)
        return resp.getcode(), json.load(resp)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
ch = get(A + "/auth/pow-challenge?username=alice")
challenge, diff = ch["challenge"], ch["difficulty"]
def clz(d):
    b=0
    for x in d:
        if x==0: b+=8; continue
        b+=8-x.bit_length(); break
    return b
n=0
while clz(hashlib.sha256((challenge+str(n)).encode()).digest())<diff: n+=1
reg = dict(username="alice", email="a@x.com", salt="s", recoverySalt="rs",
    authVerifier="AV", recAuthVerifier="RV",
    wrappedDataKeyPw={"iv":"aXY=","ct":"Y3Q="}, wrappedDataKeyRec={"iv":"aXY=","ct":"Y3Q="},
    powChallenge=challenge, powNonce=str(n))
print("valid PoW  →", post(A+"/auth/register", reg)[0], "(want 201)")
bad = dict(reg); bad["username"]="bob"; bad["powNonce"]="0"; bad["email"]="b@x.com"
print("bad PoW    →", post(A+"/auth/register", bad)[0], "(want 403)")
PY
kill %1 2>/dev/null; rm -rf "$SCRATCH"
```

Expected output: `valid PoW → 201 (want 201)` and `bad PoW → 403 (want 403)`.

- [ ] **Step 5: Verify the backend suite still passes**

Run: `cd api && source .venv/bin/activate && python -m pytest -q`
Expected: all pass (PoW disabled by conftest, so this task's model change doesn't break other tests).

- [ ] **Step 6: Commit**

```bash
git add api/models.py api/function_app.py
git commit -m "$(cat <<'EOF'
Gate registration behind proof-of-work

New GET /auth/pow-challenge issues a challenge; register now verifies the
PoW before any e-mail reservation or PBKDF2 hashing, so unsolved requests
cost the server almost nothing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Defer the verification e-mail

**Files:**
- Modify: `api/function_app.py` (`register` stops sending; new `_maybe_send_verification`; `create_note` auto-sends on limit)

**Interfaces:**
- Consumes: `_prepare_verification`, `mailer.send_verification_email`, `users_repo.save_user`, `notes_repo.count_notes` (all existing).
- Produces: no new public API; behaviour change only.

- [ ] **Step 1: Stop sending e-mail at registration**

In `register`, replace the tail that currently reads:

```python
    link = _prepare_verification(user)
    if not users_repo.add_user(user):
        users_repo.release_email(email)  # rollback rezervace
        return _error("Uživatelské jméno je obsazené", 409)
    if link:
        mailer.send_verification_email(user.email, link)
    return _json(
        {"token": auth.create_token(user.username), "emailVerified": user.email_verified},
        201,
    )
```

with (no token prepared, no mail sent at registration):

```python
    if not users_repo.add_user(user):
        users_repo.release_email(email)  # rollback rezervace
        return _error("Uživatelské jméno je obsazené", 409)
    return _json(
        {"token": auth.create_token(user.username), "emailVerified": user.email_verified},
        201,
    )
```

- [ ] **Step 2: Add the `_maybe_send_verification` helper**

Add just below `_prepare_verification` (after line ~84):

```python
def _maybe_send_verification(user: User) -> None:
    """Pošle ověřovací e-mail, jen když uživatel nemá platný token (anti-spam)."""
    if not user.email:
        return
    if (
        user.verify_token_hash
        and user.verify_expires
        and datetime.utcnow() < user.verify_expires
    ):
        return  # aktivní token → neposílat znovu
    link = _prepare_verification(user)
    users_repo.save_user(user)
    if link:
        mailer.send_verification_email(user.email, link)
```

- [ ] **Step 3: Auto-send when the soft-gate blocks a note**

In `create_note`, change the soft-gate block from:

```python
    account = users_repo.get_user(user)
    if (
        account is not None
        and not account.email_verified
        and notes_repo.count_notes(user) >= _UNVERIFIED_NOTE_LIMIT
    ):
        return _error(
            f"Ověř svůj e-mail pro víc než {_UNVERIFIED_NOTE_LIMIT} poznámek.", 403
        )
```

to (send the mail before returning 403):

```python
    account = users_repo.get_user(user)
    if (
        account is not None
        and not account.email_verified
        and notes_repo.count_notes(user) >= _UNVERIFIED_NOTE_LIMIT
    ):
        _maybe_send_verification(account)
        return _error(
            f"Ověř svůj e-mail pro víc než {_UNVERIFIED_NOTE_LIMIT} poznámek.", 403
        )
```

- [ ] **Step 4: Live HTTP verification**

Run (in-memory func, PoW disabled so we can register plainly; mailer logs the link when ACS is unconfigured):

```bash
SCRATCH="$(pwd)/../scratchpad-mail"; mkdir -p "$SCRATCH"
cd api && source .venv/bin/activate
POW_DIFFICULTY=0 func start --port 7087 > "$SCRATCH/f.log" 2>&1 &
for i in $(seq 1 30); do grep -qE "http://localhost:7087/api" "$SCRATCH/f.log" && break; sleep 1; done
A=http://localhost:7087/api; WK='{"iv":"aXY=","ct":"Y3Q="}'
TOK=$(curl -s -X POST $A/auth/register -H 'Content-Type: application/json' \
  -d "{\"username\":\"m\",\"email\":\"m@x.com\",\"salt\":\"s\",\"recoverySalt\":\"rs\",\"authVerifier\":\"AV\",\"recAuthVerifier\":\"RV\",\"wrappedDataKeyPw\":$WK,\"wrappedDataKeyRec\":$WK,\"powChallenge\":\"x\",\"powNonce\":\"0\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "verifikační maily po registraci (want 0):" $(grep -c "verify?user=" "$SCRATCH/f.log")
for i in $(seq 1 10); do curl -s -o /dev/null -X POST $A/notes -H "X-Auth-Token: $TOK" -H 'Content-Type: application/json' -d "$WK"; done
curl -s -o /dev/null -X POST $A/notes -H "X-Auth-Token: $TOK" -H 'Content-Type: application/json' -d "$WK"  # 11th → 403 + mail
curl -s -o /dev/null -X POST $A/notes -H "X-Auth-Token: $TOK" -H 'Content-Type: application/json' -d "$WK"  # 12th → 403, no re-send
sleep 1
echo "verifikační maily po limitu (want 1):" $(grep -c "verify?user=" "$SCRATCH/f.log")
kill %1 2>/dev/null; rm -rf "$SCRATCH"
```

Expected: `...po registraci (want 0): 0` and `...po limitu (want 1): 1` (sent once at the 11th note, not re-sent at the 12th).

- [ ] **Step 5: Commit**

```bash
git add api/function_app.py
git commit -m "$(cat <<'EOF'
Defer verification e-mail until an account shows intent

Registration no longer e-mails; the verification link is sent when an
unverified account first hits the note limit (once, guarded by an active
token) — plus the existing resend button. Keeps mass-registered fake
accounts from ever triggering mail and trashing domain reputation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend solver (`frontend/src/pow.ts` + worker)

**Files:**
- Create: `frontend/src/pow.ts`
- Create: `frontend/src/powWorker.ts`
- Create: `frontend/src/pow.test.ts`

**Interfaces:**
- Consumes: `createSHA256` from `hash-wasm`.
- Produces:
  - `countLeadingZeroBits(bytes: Uint8Array): number`
  - `findNonce(challenge: string, difficulty: number): Promise<string>`
  - `solvePow(challenge: string, difficulty: number): Promise<string>` (runs `findNonce` in a Web Worker)

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/pow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { countLeadingZeroBits, findNonce } from './pow'

describe('countLeadingZeroBits', () => {
  it('counts zero bits across bytes', () => {
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0)
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8)
    expect(countLeadingZeroBits(new Uint8Array([0x0f]))).toBe(4)
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16)
  })
})

describe('findNonce', () => {
  it('returns "0" immediately when difficulty is 0', async () => {
    expect(await findNonce('challenge', 0)).toBe('0')
  })

  it('finds a nonce meeting a low difficulty', async () => {
    const difficulty = 10
    const nonce = await findNonce('some-challenge', difficulty)
    // verify the returned nonce actually satisfies the target
    const buf = new TextEncoder().encode('some-challenge' + nonce)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
    expect(countLeadingZeroBits(digest)).toBeGreaterThanOrEqual(difficulty)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pow.test.ts`
Expected: FAIL — cannot resolve `./pow`.

- [ ] **Step 3: Write `frontend/src/pow.ts`**

```typescript
// Proof-of-work řešitel (anti-bot brzda registrace). Hledá nonce tak, aby
// SHA-256(challenge+nonce) mělo aspoň `difficulty` úvodních nulových bitů.
// Náročné hledání běží ve Web Workeru, ať neztuhne UI; ověření na serveru
// je jeden hash.
import { createSHA256 } from 'hash-wasm'

export function countLeadingZeroBits(bytes: Uint8Array): number {
  let bits = 0
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += 8 - (32 - Math.clz32(byte)) // 8 - bitová délka bajtu
    break
  }
  return bits
}

// Tight loop – blokuje vlákno (proto se pouští ve workeru). Testovatelné přímo.
export async function findNonce(challenge: string, difficulty: number): Promise<string> {
  if (difficulty <= 0) return '0'
  const hasher = await createSHA256()
  const enc = new TextEncoder()
  for (let nonce = 0; ; nonce++) {
    hasher.init()
    hasher.update(enc.encode(challenge + nonce))
    const digest = hasher.digest('binary')
    if (countLeadingZeroBits(digest) >= difficulty) return String(nonce)
  }
}

// Veřejné API: vyřeší ve Web Workeru.
export function solvePow(challenge: string, difficulty: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./powWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<string>) => {
      resolve(e.data)
      worker.terminate()
    }
    worker.onerror = () => {
      reject(new Error('Ověření proti robotům selhalo'))
      worker.terminate()
    }
    worker.postMessage({ challenge, difficulty })
  })
}
```

Note on `countLeadingZeroBits`: for a non-zero byte, its bit length is `32 - Math.clz32(byte)`, so leading zeros within the byte are `8 - bitLength`. `Math.clz32` operates on 32-bit ints; bytes are ≤ 0xff so this is exact.

- [ ] **Step 4: Write `frontend/src/powWorker.ts`**

```typescript
// Web Worker: vyřeší PoW mimo hlavní vlákno a pošle nalezený nonce zpět.
import { findNonce } from './pow'

self.onmessage = async (e: MessageEvent<{ challenge: string; difficulty: number }>) => {
  const { challenge, difficulty } = e.data
  const nonce = await findNonce(challenge, difficulty)
  ;(self as unknown as Worker).postMessage(nonce)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/pow.test.ts`
Expected: PASS (2 suites). Then the full unit run:
Run: `npx vitest run`
Expected: all existing suites still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pow.ts frontend/src/powWorker.ts frontend/src/pow.test.ts
git commit -m "$(cat <<'EOF'
Add client proof-of-work solver

SHA-256 leading-zero-bits search over hash-wasm, run in a Web Worker so
the ~0.3s solve doesn't freeze the UI. Pure core (countLeadingZeroBits,
findNonce) is unit-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire the solver into registration

**Files:**
- Modify: `frontend/src/authApi.ts` (`register`)
- Modify: `frontend/src/AuthGate.tsx` (`RegisterForm`)

**Interfaces:**
- Consumes: `solvePow` from Task 4; `GET /auth/pow-challenge` from Task 2.
- Produces: `register(username, email, password, onSolving?: () => void)` — the optional callback fires just before the (potentially perceptible) solve so the UI can show a message.

- [ ] **Step 1: Import the solver in `authApi.ts`**

At the top of `frontend/src/authApi.ts`, add to the imports:

```typescript
import { solvePow } from './pow'
```

- [ ] **Step 2: Fetch + solve the challenge inside `register`**

Change the `register` signature to accept the optional callback:

```typescript
export async function register(
  username: string,
  email: string,
  password: string,
  onSolving?: () => void,
): Promise<string> {
```

Then, inside `register`, **before** the `const res = await postJson('register', {...})` call (right after the `wrappedDataKeyPw` is computed), insert:

```typescript
  // Proof-of-work: vyzvedni výzvu a vyřeš ji (brzda proti hromadné registraci).
  const powRes = await fetch(
    `${AUTH_URL}/pow-challenge?username=${encodeURIComponent(username)}`,
  )
  if (!powRes.ok) throw new Error('Registrace se nepovedla')
  const { challenge, difficulty } = await powRes.json()
  onSolving?.()
  const powNonce = await solvePow(challenge, difficulty)
```

And add the two fields to the `postJson('register', {...})` body (alongside `wrappedDataKeyRec`):

```typescript
    wrappedDataKeyRec: await wrapDataKey(dataKey, recKeys.encKey),
    powChallenge: challenge,
    powNonce,
```

- [ ] **Step 3: Show the solving state in `RegisterForm`**

In `frontend/src/AuthGate.tsx` `RegisterForm`, add a state near the other `useState` calls:

```typescript
  const [solving, setSolving] = useState(false)
```

Change the `register` call in `submit` to pass the callback:

```typescript
      const code = await authApi.register(
        username.trim(), email.trim(), password, () => setSolving(true),
      )
      setRecoveryCode(code)
```

And in the `catch`, also clear it so a failed attempt resets the label:

```typescript
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registrace se nepovedla')
      setSolving(false)
      setBusy(false)
    }
```

Update the submit button label to reflect the phase:

```typescript
        <button className="auth-btn" type="submit" disabled={busy || !username || !password}>
          {solving ? 'ověřuji, že nejsi robot…' : busy ? 'zakládám trezor…' : 'Create account'}
        </button>
```

- [ ] **Step 4: Type-check and build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes with no errors and Vite produces `dist/` (the worker is bundled as a separate chunk). Then:
Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/authApi.ts frontend/src/AuthGate.tsx
git commit -m "$(cat <<'EOF'
Solve proof-of-work during registration

register() fetches a PoW challenge, solves it in the Web Worker and sends
the nonce; the button shows "ověřuji, že nejsi robot…" while solving.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: End-to-end smoke check

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `cd api && source .venv/bin/activate && python -m pytest -q`
Expected: all pass.

- [ ] **Step 2: Full frontend suite + build**

Run: `cd frontend && npx vitest run && npm run build && npm run lint`
Expected: all tests pass, build succeeds, lint clean.

- [ ] **Step 3: Manual browser check (optional but recommended)**

Serve the built `dist/` with the local func (`POW_DIFFICULTY=20`) behind it and register a new account in a real browser: confirm the button briefly shows "ověřuji, že nejsi robot…", registration succeeds, and no verification e-mail is logged until you exceed 10 notes. (Use the existing static-server + proxy approach from earlier sessions; vite dev may hit the inotify limit.)

- [ ] **Step 4: Final review**

Confirm the branch is clean (`git status`) and all six tasks' commits are present (`git log --oneline -8`).
