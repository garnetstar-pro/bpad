# Proof-of-work registration + deferred verification email

**Date:** 2026-07-11
**Status:** Approved design

## Problem

A bot can create thousands of fake accounts using generated, unique fake
e-mail addresses. Existing defenses do not stop this:

- **Unique-email index** only blocks the *same* address twice; generated
  addresses are all distinct.
- **In-memory rate limiter** is per-instance (Functions scales out) and is
  trivially bypassed by rotating IPs.
- **Soft-gate (10 notes)** limits *data per account* but not account *creation*.

The concrete harms of mass registration, ranked:

1. **E-mail domain reputation.** `register` currently sends a verification
   e-mail on every registration. Thousands of mails to random/nonexistent
   addresses raise the bounce rate, and ACS / receiving servers will throttle
   or block `bpad.pro` — breaking delivery for legitimate users too.
2. **Server CPU.** Each `register` runs PBKDF2 (100k iterations) twice
   (`hash_verifier` on the auth and recovery verifiers). Mass registration
   burns compute.
3. **Cosmos RU + storage.** Each account writes to `users` + `email_index`.

## Goals

- Make mass account creation *linearly expensive* for the client, with
  negligible cost to the server (asymmetric cost).
- Protect the e-mail domain's reputation by not sending mail to accounts that
  never show human intent.
- No third-party service (no reCAPTCHA/Turnstile) — keep the zero-knowledge,
  nothing-leaves-the-app ethos. No new external script (CSP-clean).
- No new Cosmos container and no extra RU per registration.

## Non-goals

- Stopping a determined attacker with a GPU/hash farm. Proof-of-work *raises
  the cost*, it does not eliminate the threat. It is one layer alongside the
  deferred e-mail and the soft-gate.
- PoW on login/recover (out of scope; the rate limiter covers those). This
  change targets *account creation*.
- Adaptive difficulty (future enhancement; see below).

## Design

### 1. Proof-of-work: stateless, HMAC-signed, bound to username

**Challenge issuance** — `GET /auth/pow-challenge?username=X`:

```
payload    = base64url(json{ ts, rand, difficulty })
signature  = HMAC_SHA256(secret, payload + "|" + username)
challenge  = payload + "." + base64url(signature)
response   = { "challenge": challenge, "difficulty": difficulty }
```

- `secret` is derived from `SESSION_SIGNING_KEY` with a domain-separation
  prefix (e.g. `HMAC(signing_key, "pow")`) so it is distinct from the JWT
  signing use.
- `ts` is the issue time (epoch seconds); `rand` is 16 random bytes.
- `difficulty` is read from env `POW_DIFFICULTY` (default 20). It is embedded
  in the signed payload so the client cannot lower it.

**Solution** — the client finds a `nonce` (a string/number) such that:

```
SHA256(challenge + nonce)  has  >= difficulty  leading zero bits
```

**Verification** — inside `POST /auth/register`, using the `username` from the
register body:

1. Split `challenge` into `payload` and `signature`.
2. Recompute `HMAC_SHA256(secret, payload + "|" + username)` and compare
   constant-time. **Binding to username here is what recomputes over the
   submitted username** — a challenge issued for one username fails for another.
3. Decode `payload`; reject if `now - ts > _POW_TTL` (120 s) or in the future.
4. Compute `SHA256(challenge + nonce)` and require `>= difficulty` leading
   zero bits.

If `difficulty == 0` (env `POW_DIFFICULTY=0`), PoW is **disabled**: issuance
returns `difficulty: 0` and verification accepts unconditionally. Used for
local dev and most tests.

### Anti-replay without storage

Stateless challenges can be replayed within their TTL. Two properties make a
DB unnecessary:

- **Username binding.** A solved `(challenge, nonce)` is valid only for the
  username it was signed for.
- **Username is consumed on success.** After a successful registration that
  username (and its e-mail) is taken; replaying the same
  `(challenge, nonce, username)` fails at `add_user` / `reserve_email`.

Therefore **every distinct new account requires a fresh solve.** The 120 s TTL
only bounds pre-computation/hoarding of challenges. Issuing challenges is cheap
for us (one HMAC, stateless); solving is expensive for the attacker. The
`pow-challenge` endpoint is rate-limited like the other auth endpoints so it
cannot be abused as a free HMAC oracle.

### Ordering in `register` (cheap-check-first)

PoW is verified **before** any expensive or state-changing work:

```
1. parse body
2. verify PoW            → invalid: 403, return immediately
3. validate e-mail
4. reserve_email          (Cosmos write)
5. hash_verifier x2       (PBKDF2, expensive)
6. add_user
```

A bot without a valid solution costs us one HMAC + one SHA256, nothing else.

### 2. Deferred verification e-mail (combination)

- **Registration sends no e-mail** and does not prepare a verify token.
  Remove the `_prepare_verification` + `send_verification_email` calls from
  `register`.
- **Auto-send on hitting the soft-gate:** in `create_note`, when an unverified
  account is blocked at the note limit, prepare a verify token and send the
  e-mail *before* returning 403 — but only if there is no active
  (unexpired) token, to avoid re-sending on every blocked POST. Save the user.
- **Button in the banner:** the existing `send-verification` endpoint stays for
  users who want to verify earlier.

A bot that never writes an 11th note and never clicks never triggers a send,
so mail only ever goes to addresses behind human intent.

### 3. Client solver (`frontend/src/pow.ts`)

- `solvePow(challenge, difficulty, onProgress?) => Promise<string>` — iterates
  `nonce = 0, 1, 2, …`, hashing with **SHA-256 from hash-wasm** (already a
  dependency for Argon2id; its reusable synchronous hasher allows a tight loop
  far faster than per-call `crypto.subtle.digest`).
- Runs in a **Web Worker** so the ~0.3 s search does not freeze the UI. CSP
  already allows `worker-src` (used by the PWA service worker).
- Leading-zero-bit count over the raw digest bytes; return the first nonce that
  meets `difficulty`. If `difficulty == 0`, return `"0"` immediately.

### 4. Frontend wiring

- `authApi.ts` `register(username, email, password)`:
  1. `GET /auth/pow-challenge?username` → `{ challenge, difficulty }`
  2. `await solvePow(challenge, difficulty, onProgress)`
  3. include `powChallenge` + `powNonce` in the existing register POST body.
- `AuthGate.tsx` register form shows a progress state while solving
  ("Ověřuji, že nejsi robot… (chvilka)") with a spinner, then proceeds to the
  recovery-code screen as today.

## Data model changes

- `RegisterRequest` (`api/models.py`) gains `powChallenge: str` and
  `powNonce: str` (required).

No Cosmos schema changes. No new container.

## Affected files

| File | Change |
|---|---|
| `api/pow.py` *(new)* | `issue_challenge`, `verify_solution`, `_POW_TTL`, difficulty from env, HMAC secret derivation, leading-zero-bit check |
| `api/function_app.py` | new `GET /auth/pow-challenge` route (rate-limited); PoW check first in `register`; remove registration e-mail send; auto-send in `create_note` on limit hit |
| `api/models.py` | `RegisterRequest` + `powChallenge`, `powNonce` |
| `frontend/src/pow.ts` *(new)* | Web Worker solver over hash-wasm SHA-256 |
| `frontend/src/authApi.ts` | fetch challenge, solve, attach to register |
| `frontend/src/AuthGate.tsx` | progress/spinner state during solve |

## Testing (TDD)

**Backend `api/test_pow.py`:**
- valid solution verifies true
- wrong nonce → false
- tampered challenge (bad HMAC) → false
- expired challenge (ts older than TTL) → false
- challenge signed for a different username → false
- `difficulty == 0` → disabled, verification accepts

**Frontend `frontend/src/pow.test.ts`:**
- leading-zero-bit counting is correct on known digests
- `solvePow` at a low difficulty (e.g. 8) returns a nonce whose
  `SHA256(challenge+nonce)` actually meets the difficulty
- `difficulty == 0` returns immediately

**Live HTTP (existing pattern, in-memory func):**
- register with no / invalid PoW → rejected (403)
- register with a valid solved PoW → 201
- registration sends **no** e-mail (log shows none)
- after the 11th note, an e-mail **is** prepared and sent (log shows the link);
  repeated blocked POSTs do not re-send while the token is valid

## Configuration

- `POW_DIFFICULTY` (env, default `20`). `0` disables PoW.
- Tests default to `0` (via `conftest.py`), except the PoW-specific tests which
  set a small non-zero difficulty.
- Reuses `SESSION_SIGNING_KEY`; no new secret to provision.

## Future enhancements (out of scope)

- **Adaptive difficulty:** raise `difficulty` for source IPs showing a burst of
  challenge requests; legitimate users keep the low default.
- **Cloudflare Turnstile** in front of SWA if PoW proves insufficient.
- Periodic orphan cleanup of `email_index` entries for abandoned accounts.
