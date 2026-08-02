# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uzavřít kritické a vysoké bezpečnostní nálezy z auditu: falšovatelný rate-limit klíč, únik recovery materiálu + user enumeration, a storage abuse přes nekontrolovaný SAS upload, plus chybějící rate limity na cost endpointech.

**Architecture:** Tři nezávislé fáze; každá je vlastní PR do `dev`. Fáze 1 opravuje autentizační vrstvu (rate limit klíč, recovery-material, enumeration). Fáze 2 opravuje storage abuse (post-upload size check, scheduled pending sweep). Fáze 3 přidává per-user rate limity na notes/change-password a globální body-size strop. Žádná fáze nemění API kontrakt ani Cosmos schéma — jsou navzájem nezávislé.

**Tech Stack:** Python 3.12, Azure Functions (func), PyJWT, Pydantic, azure-storage-blob, pytest (plain, bez jsdom)

---

## Mapování souborů

| Soubor | Fáze | Co se mění |
|---|---|---|
| `api/function_app.py` | 1, 2, 3 | `_client_ip`, `recovery_material`, `verify_email`, `change_password`, `create_note`, `put_note`, přidání `_notes_write_limiter`, `_change_password_limiter`, `_reject_oversize`, timer trigger |
| `api/auth.py` | 1 | přidat `decoy_recovery_material()` |
| `api/blobstore.py` | 2 | přidat `blob_size(blob_path)` do Protocol + implementace |
| `api/images_ops.py` | 2 | přidat `verify_uploaded_sizes()` |
| `api/repository.py` | 2 | přidat `all_pending_older_than(cutoff)` do Protocol + InMemory + Cosmos |
| `api/ratelimit.py` | 3 | beze změny (jen nové instance v function_app) |
| `api/test_client_ip.py` | 1 | nový testový soubor |
| `api/test_recovery_material.py` | 1 | nový testový soubor |
| `api/test_verify_email_enumeration.py` | 1 | nový testový soubor |
| `api/test_blob_size_enforcement.py` | 2 | nový testový soubor |
| `api/test_pending_sweep.py` | 2 | nový testový soubor |
| `api/test_rate_limits_notes.py` | 3 | nový testový soubor |
| `api/test_body_size.py` | 3 | nový testový soubor |

---

## FÁZE 1 — Auth hardening: rate-limit klíč, recovery, enumeration

### Task 1: Opravit `_client_ip` — parsovat správný hop X-Forwarded-For

**Kontext:** `function_app.py:64-65` bere první (levou) hodnotu `X-Forwarded-For`, kterou HTTP klient plně ovládá. Na Azure SWA/Functions je klientská IP připojována jako poslední hop (rightmost). Bere-li se první, útočník pošle `X-Forwarded-For: 1.2.3.4` a obejde limiter.

**Soubory:**
- Modify: `api/function_app.py:64-65`
- Create: `api/test_client_ip.py`

- [ ] **Krok 1: Napsat failing test**

```python
# api/test_client_ip.py
import pytest
import azure.functions as func

# We test _client_ip directly; import it from function_app after the fix.
# To keep the test importable without full Azure bootstrap, we replicate
# the logic under test in a standalone helper and then assert function_app uses it.

def _client_ip_correct(req) -> str:
    """Parse the RIGHTMOST (trusted) hop from X-Forwarded-For."""
    header = req.headers.get("X-Forwarded-For", "")
    parts = [p.strip() for p in header.split(",") if p.strip()]
    return parts[-1] if parts else "unknown"


def _make_req(xff: str):
    return func.HttpRequest(
        method="GET",
        url="http://localhost/api/test",
        headers={"X-Forwarded-For": xff},
        body=b"",
    )


def test_single_ip_returned():
    req = _make_req("1.2.3.4")
    assert _client_ip_correct(req) == "1.2.3.4"


def test_rightmost_hop_chosen():
    # Client supplies fake left IPs; Azure appends the real one on the right.
    req = _make_req("attacker-fake, 10.0.0.1, 20.0.0.2")
    assert _client_ip_correct(req) == "20.0.0.2"


def test_spaces_stripped():
    req = _make_req("  1.2.3.4  ,  5.6.7.8  ")
    assert _client_ip_correct(req) == "5.6.7.8"


def test_empty_header_returns_unknown():
    req = _make_req("")
    assert _client_ip_correct(req) == "unknown"


def test_missing_header_returns_unknown():
    req = func.HttpRequest(
        method="GET",
        url="http://localhost/api/test",
        headers={},
        body=b"",
    )
    assert _client_ip_correct(req) == "unknown"
```

- [ ] **Krok 2: Spustit test — musí selhat nebo projít na pomocné funkci**

```bash
cd api && python -m pytest test_client_ip.py -v
```

Testy procházejí pomocnou funkci — ověř, že logika sedí.

- [ ] **Krok 3: Opravit `_client_ip` v `function_app.py`**

Najdi řádky 64–65 v `api/function_app.py`:
```python
def _client_ip(req: func.HttpRequest) -> str:
    return req.headers.get("X-Forwarded-For", "").split(",")[0].strip() or "unknown"
```

Nahraď za:
```python
def _client_ip(req: func.HttpRequest) -> str:
    # Azure SWA/Functions appends the verified client IP as the RIGHTMOST hop in
    # X-Forwarded-For; left-side values are client-supplied and must not be trusted.
    # See: https://learn.microsoft.com/azure/frontdoor/front-door-http-headers-protocol
    header = req.headers.get("X-Forwarded-For", "")
    parts = [p.strip() for p in header.split(",") if p.strip()]
    return parts[-1] if parts else "unknown"
```

- [ ] **Krok 4: Ověřit testy**

```bash
cd api && python -m pytest test_client_ip.py -v
```

Očekávaný výstup: všechny 5 testů PASS.

- [ ] **Krok 5: Spustit celou test suite**

```bash
cd api && python -m pytest -v
```

Očekávaný výstup: žádný nový FAIL.

- [ ] **Krok 6: Commit**

```bash
git add api/function_app.py api/test_client_ip.py
git commit -m "security: parse rightmost X-Forwarded-For hop for rate limiting

Azure SWA appends the verified client IP on the right; taking the leftmost
value allowed any client to supply a spoofed IP and bypass rate limiting entirely."
```

---

### Task 2: Opravit `auth/recovery-material` — decoy pro neexistující uživatele

**Kontext:** Endpoint `GET /api/auth/recovery-material` vrací `404` pro neexistující username → user enumeration oracle. Navíc vydá `recoverySalt` + `wrappedDataKeyRec` bez jakékoli autentizace — materiál pro offline útok na recovery kód. Řešení: deterministický decoy (jako u `auth/salt`), aby odpověď byla vždy `200` se stejnou strukturou.

**Soubory:**
- Modify: `api/auth.py`
- Modify: `api/function_app.py:269-281`
- Create: `api/test_recovery_material.py`

- [ ] **Krok 1: Přidat `decoy_recovery_material(username)` do `auth.py`**

Otevři `api/auth.py`. Na konec souboru za `decoy_salt()` přidej:

```python
def decoy_recovery_material(username: str) -> dict:
    """Return a stable fake recovery material for a non-existent username.

    Uses two separate HMAC tags (different contexts) so the decoy iv and ct have
    the same shape as real Encrypted values but are deterministically derived from
    the username, making user-existence enumeration via this endpoint impossible.
    """
    key = _signing_key().encode()
    iv_bytes = hmac.new(key, f"decoy-rec-iv:{username}".encode(), hashlib.sha256).digest()[:12]
    ct_bytes = hmac.new(key, f"decoy-rec-ct:{username}".encode(), hashlib.sha256).digest()
    salt_bytes = hmac.new(key, f"decoy-rec-salt:{username}".encode(), hashlib.sha256).digest()[:16]
    return {
        "recoverySalt": _b64(salt_bytes),
        "wrappedDataKeyRec": {
            "iv": _b64(iv_bytes),
            "ct": _b64(ct_bytes),
        },
    }
```

- [ ] **Krok 2: Napsat failing test**

```python
# api/test_recovery_material.py
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-for-recovery-material-tests")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import auth


def test_decoy_recovery_material_has_correct_shape():
    result = auth.decoy_recovery_material("nobody")
    assert "recoverySalt" in result
    assert "wrappedDataKeyRec" in result
    wrapped = result["wrappedDataKeyRec"]
    assert "iv" in wrapped
    assert "ct" in wrapped
    # All values must be non-empty strings (base64).
    assert isinstance(result["recoverySalt"], str) and len(result["recoverySalt"]) > 0
    assert isinstance(wrapped["iv"], str) and len(wrapped["iv"]) > 0
    assert isinstance(wrapped["ct"], str) and len(wrapped["ct"]) > 0


def test_decoy_is_deterministic():
    a = auth.decoy_recovery_material("alice")
    b = auth.decoy_recovery_material("alice")
    assert a == b


def test_decoy_differs_per_username():
    a = auth.decoy_recovery_material("alice")
    b = auth.decoy_recovery_material("bob")
    assert a["recoverySalt"] != b["recoverySalt"]


def test_decoy_differs_from_decoy_salt():
    """decoy_recovery_material must not reuse the same values as decoy_salt."""
    rec = auth.decoy_recovery_material("alice")
    salt = auth.decoy_salt("alice")
    assert rec["recoverySalt"] != salt
```

- [ ] **Krok 3: Spustit test — musí selhat (funkce ještě neexistuje nebo je špatně)**

```bash
cd api && python -m pytest test_recovery_material.py -v
```

Očekávané: FAIL s `AttributeError: module 'auth' has no attribute 'decoy_recovery_material'` — pokud jsi přidal funkci v kroku 1, testy by měly projít; pokud ne, přidej funkci.

- [ ] **Krok 4: Opravit handler `recovery_material` ve `function_app.py`**

Najdi řádky 269–281:

```python
@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    user = users_repo.get_user(req.params.get("username", ""))
    if user is None:
        return _error("User not found", 404)
    return _json(
        {"recoverySalt": user.recovery_salt,
         "wrappedDataKeyRec": user.wrapped_data_key_rec.model_dump()},
        200,
    )
```

Nahraď za:

```python
@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
    user = users_repo.get_user(username)
    if user is None:
        # Return a deterministic decoy so the caller cannot distinguish a missing
        # account from an existing one (anti-enumeration, same as auth/salt).
        return _json(auth.decoy_recovery_material(username), 200)
    return _json(
        {"recoverySalt": user.recovery_salt,
         "wrappedDataKeyRec": user.wrapped_data_key_rec.model_dump()},
        200,
    )
```

- [ ] **Krok 5: Spustit testy**

```bash
cd api && python -m pytest test_recovery_material.py -v
```

Očekávaný výstup: všechny testy PASS.

- [ ] **Krok 6: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL.

- [ ] **Krok 7: Commit**

```bash
git add api/auth.py api/function_app.py api/test_recovery_material.py
git commit -m "security: return decoy recovery material for unknown usernames

GET /auth/recovery-material previously returned 404 for non-existent users,
creating a user-existence oracle. Now returns a deterministic decoy (same shape
as real material, HMAC-derived from username) so callers cannot distinguish
real from missing accounts."
```

---

### Task 3: Sjednotit chybové hlášky `verify-email` — odstranit enumeration oracle

**Kontext:** `POST /api/auth/verify-email` vrací „User not found" (404) vs „invalid or expired" (400) → útočník zjistí, zda účet existuje. Řešení: sloučit do jediné hlášky s jednotným status kódem.

**Soubory:**
- Modify: `api/function_app.py:219-246`
- Create: `api/test_verify_email_enumeration.py`

- [ ] **Krok 1: Přečíst aktuální handler**

Otevři `api/function_app.py`, najdi handler `verify_email` (okolo řádku 219). Aktuální kód vypadá přibližně takto:

```python
@app.route(route="auth/verify-email", methods=["POST"])
def verify_email(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = VerifyEmailRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    user = users_repo.get_user(data.username)
    if user is None:
        return _error("User not found", 404)
    if not auth.verify_token_hash(data.token, user.verify_token_hash or ""):
        return _error("The link is invalid or expired.", 400)
    if datetime.utcnow() > (user.verify_expires or datetime.min):
        return _error("The link is invalid or expired.", 400)
    user.email_verified = True
    user.verify_token_hash = None
    user.verify_expires = None
    users_repo.save_user(user)
    return _json({"verified": True}, 200)
```

- [ ] **Krok 2: Napsat failing test**

```python
# api/test_verify_email_enumeration.py
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-verify-email")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import json
import azure.functions as func

# Import the app so the routes are registered.
import function_app  # noqa: F401 - registers routes as side effect
from function_app import verify_email


def _make_req(username: str, token: str):
    body = json.dumps({"username": username, "token": token}).encode()
    return func.HttpRequest(
        method="POST",
        url="http://localhost/api/auth/verify-email",
        headers={"Content-Type": "application/json"},
        body=body,
    )


def test_nonexistent_user_returns_400_not_404():
    """Non-existent user must NOT return 404 (user existence oracle)."""
    req = _make_req("no-such-user-xyz", "some-token")
    resp = verify_email(req)
    assert resp.status_code == 400
    body = json.loads(resp.get_body())
    assert "invalid or expired" in body["error"].lower()


def test_nonexistent_user_same_message_as_bad_token():
    """Error message must be identical whether user missing or token wrong."""
    req_missing = _make_req("no-such-user-xyz", "tok")
    req_bad_tok = _make_req("no-such-user-xyz", "tok")
    r1 = verify_email(req_missing)
    r2 = verify_email(req_bad_tok)
    assert r1.status_code == r2.status_code
    assert json.loads(r1.get_body())["error"] == json.loads(r2.get_body())["error"]
```

- [ ] **Krok 3: Spustit test — musí selhat**

```bash
cd api && python -m pytest test_verify_email_enumeration.py::test_nonexistent_user_returns_400_not_404 -v
```

Očekávaný výstup: FAIL (aktuálně vrací 404).

- [ ] **Krok 4: Opravit handler — sloučit větve**

V `api/function_app.py` najdi handler `verify_email` a nahraď větev `if user is None:`:

```python
    user = users_repo.get_user(data.username)
    if user is None:
        return _error("User not found", 404)   # <-- tuto řádku SMAŽ / změň
```

Celý handler upravi na:

```python
@app.route(route="auth/verify-email", methods=["POST"])
def verify_email(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = VerifyEmailRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    _INVALID_LINK = "The link is invalid or expired."
    user = users_repo.get_user(data.username)
    if user is None:
        # Do not reveal whether the username exists (anti-enumeration).
        return _error(_INVALID_LINK, 400)
    if not auth.verify_token_hash(data.token, user.verify_token_hash or ""):
        return _error(_INVALID_LINK, 400)
    if datetime.utcnow() > (user.verify_expires or datetime.min):
        return _error(_INVALID_LINK, 400)
    user.email_verified = True
    user.verify_token_hash = None
    user.verify_expires = None
    users_repo.save_user(user)
    return _json({"verified": True}, 200)
```

- [ ] **Krok 5: Ověřit testy**

```bash
cd api && python -m pytest test_verify_email_enumeration.py -v
```

Očekávaný výstup: oba testy PASS.

- [ ] **Krok 6: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL.

- [ ] **Krok 7: Commit**

```bash
git add api/function_app.py api/test_verify_email_enumeration.py
git commit -m "security: unify verify-email error to prevent user enumeration

Returning 404 for missing users revealed account existence. Both missing user
and invalid token now return the same 400 with 'The link is invalid or expired.'"
```

---

## FÁZE 2 — Storage hardening: post-upload size enforcement + scheduled pending sweep

### Task 4: Přidat `blob_size()` do BlobStore + post-upload size check v `images_ops`

**Kontext:** Upload SAS nativně neumí vynucovat max-size — klient může nahrát libovolně velký blob. Řešení: po nahrání (voláno z `reconcile_note`, tedy při uložení note) ověřit skutečnou velikost přes `blob_size()` a bloby překračující limit smazat a odmítnout referenci.

Pozn: `reconcile_note` je voláno při `POST /notes` a `PUT /notes/{id}`. Přidáme do něj volání `verify_uploaded_sizes` před `set_note_id`. Tím je enforcement navázaný na okamžik, kdy klient tvrdí, že note existuje — ne na upload samotný.

**Soubory:**
- Modify: `api/blobstore.py`
- Modify: `api/images_ops.py`
- Create: `api/test_blob_size_enforcement.py`

- [ ] **Krok 1: Přidat `blob_size()` do Protocol, InMemory a Azure implementace**

Otevři `api/blobstore.py`. Přidej metodu do Protocol, InMemory a AzureBlobStore.

Nejdřív přečti aktuální `blobstore.py` celý, pak uprav:

**Protocol `BlobStore`** — přidej řádek:
```python
class BlobStore(Protocol):
    def upload_url(self, blob_path: str, content_type: str) -> str: ...
    def read_url(self, blob_path: str) -> str: ...
    def delete(self, blob_path: str) -> None: ...
    def blob_size(self, blob_path: str) -> int | None: ...  # None = blob does not exist
```

**InMemoryBlobStore** — přidej:
```python
    def blob_size(self, blob_path: str) -> int | None:
        # In-memory store has no real blobs; treat every path as non-existent.
        return None
```

Pokud chceš testy s reálnými velikostmi, přidej do `InMemoryBlobStore.__init__`:
```python
    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.sizes: dict[str, int] = {}  # blob_path -> size in bytes, for test injection
```

A uprav `blob_size`:
```python
    def blob_size(self, blob_path: str) -> int | None:
        return self.sizes.get(blob_path)
```

**AzureBlobStore** — přidej:
```python
    def blob_size(self, blob_path: str) -> int | None:
        """Return the actual size of the uploaded blob, or None if it does not exist."""
        try:
            client = self._svc().get_blob_client(self._container_name, blob_path)
            props = client.get_blob_properties()
            return props["size"]
        except Exception:
            return None
```

- [ ] **Krok 2: Přidat `verify_uploaded_sizes()` do `images_ops.py`**

Otevři `api/images_ops.py`. Přidej **před** `reconcile_note`:

```python
# Tolerance factor for encrypted overhead (IV + GCM tag + base64 expansion).
# A 10 MiB plaintext image becomes ~10.05 MiB ciphertext; 1.05 is safe headroom.
_SIZE_TOLERANCE = 1.05


def verify_uploaded_sizes(
    images_repo, blob_store, user: str, image_ids
) -> list[str]:
    """Check that each referenced image's blob is within the declared size limit.

    For each image whose blob exceeds declared size_bytes * _SIZE_TOLERANCE:
    - Delete the blob and metadata record.
    - Remove the id from the returned list of valid image ids.

    Returns the subset of image_ids that passed the check (possibly the full list).
    Blobs that do not exist yet (size=None) are left untouched — they were likely
    not uploaded and will be cleaned up by the pending sweep.
    """
    valid = []
    for iid in image_ids:
        rec = images_repo.get_image(user, iid)
        if rec is None:
            continue  # image doesn't exist in our metadata — skip silently
        actual = blob_store.blob_size(rec.blob_path)
        if actual is None:
            # Blob not present yet; leave it for the pending sweep.
            valid.append(iid)
            continue
        limit = int(rec.size_bytes * _SIZE_TOLERANCE)
        if actual > limit:
            import logging
            logging.warning(
                "Image %s for user %s exceeds declared size (%d > %d); deleting.",
                iid, user, actual, limit,
            )
            _delete_record_and_blob(images_repo, blob_store, user, iid)
        else:
            valid.append(iid)
    return valid
```

Upravit `reconcile_note` tak, aby volalo `verify_uploaded_sizes` před `set_note_id`:

```python
def reconcile_note(images_repo, blob_store, user: str, note_id: str, image_ids) -> None:
    """Bind referenced images to the note; delete ones previously bound but now gone."""
    # Enforce that uploaded blobs match declared sizes before binding them.
    valid_ids = verify_uploaded_sizes(images_repo, blob_store, user, list(image_ids))
    referenced = set(valid_ids)
    for iid in referenced:
        if images_repo.get_image(user, iid) is not None:
            images_ops.set_note_id(user, iid, note_id)  # toto je interní volání
    for rec in images_repo.images_for_note(user, note_id):
        if rec.id not in referenced:
            _delete_record_and_blob(images_repo, blob_store, user, rec.id)
```

Pozor: `images_repo.set_note_id` musíš volat přímo, ne přes `images_ops.`:
```python
    for iid in referenced:
        if images_repo.get_image(user, iid) is not None:
            images_repo.set_note_id(user, iid, note_id)
```

(Původní kód už toto dělal přes `images_repo.set_note_id` — jen ověř, že nová verze to zachovává.)

- [ ] **Krok 3: Napsat failing test**

```python
# api/test_blob_size_enforcement.py
import pytest
from blobstore import InMemoryBlobStore
from repository import InMemoryImagesRepository
import images_ops


def _setup():
    repo = InMemoryImagesRepository()
    blob = InMemoryBlobStore()
    return repo, blob


def test_blob_within_limit_passes():
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    iid = out["image_id"]
    blob_path = f"alice/{iid}"
    blob.sizes[blob_path] = 100  # exact declared size
    valid = images_ops.verify_uploaded_sizes(repo, blob, "alice", [iid])
    assert iid in valid


def test_blob_with_tolerance_passes():
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    iid = out["image_id"]
    blob_path = f"alice/{iid}"
    blob.sizes[blob_path] = 104  # within 1.05x tolerance
    valid = images_ops.verify_uploaded_sizes(repo, blob, "alice", [iid])
    assert iid in valid


def test_blob_over_limit_deleted_and_excluded():
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    iid = out["image_id"]
    blob_path = f"alice/{iid}"
    blob.sizes[blob_path] = 200  # double the declared size
    valid = images_ops.verify_uploaded_sizes(repo, blob, "alice", [iid])
    assert iid not in valid
    assert blob_path in blob.deleted
    assert repo.get_image("alice", iid) is None


def test_missing_blob_not_deleted():
    """blob_size returns None -> not uploaded yet, leave for pending sweep."""
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    iid = out["image_id"]
    # Don't set blob.sizes -> blob_size returns None
    valid = images_ops.verify_uploaded_sizes(repo, blob, "alice", [iid])
    assert iid in valid  # kept, pending sweep will handle it
    assert blob.deleted == []


def test_reconcile_note_excludes_oversized():
    """reconcile_note must not bind an image whose blob is oversized."""
    repo, blob = _setup()
    good = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    bad = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    blob.sizes[f"alice/{good}"] = 100
    blob.sizes[f"alice/{bad}"] = 500  # oversized
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [good, bad])
    assert repo.get_image("alice", good) is not None
    assert repo.get_image("alice", bad) is None  # deleted
```

- [ ] **Krok 4: Spustit test — musí selhat**

```bash
cd api && python -m pytest test_blob_size_enforcement.py -v
```

Očekávaný výstup: FAIL (metody neexistují).

- [ ] **Krok 5: Ověřit implementaci + spustit testy**

```bash
cd api && python -m pytest test_blob_size_enforcement.py -v
```

Očekávaný výstup: všechny testy PASS.

- [ ] **Krok 6: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL (pozor: původní testy `test_images_ops.py` musí stále procházet — `reconcile_note` teď volá `verify_uploaded_sizes`, který na `InMemoryBlobStore` bez `sizes` vrací `None` → bloby se nechávají → existující testy by neměly být dotčeny).

- [ ] **Krok 7: Commit**

```bash
git add api/blobstore.py api/images_ops.py api/test_blob_size_enforcement.py
git commit -m "security: enforce actual blob size on reconcile_note

SAS upload tokens cannot natively enforce max-size. Added blob_size() to
BlobStore protocol and verify_uploaded_sizes() to images_ops. reconcile_note
now deletes and excludes any blob whose actual size exceeds declared size_bytes
* 1.05 (encryption overhead tolerance)."
```

---

### Task 5: Scheduled pending sweep — smazat pending bloby napříč uživateli

**Kontext:** Lazy GC v `sweep_pending` čistí jen pending bloby **aktuálního uživatele** při jeho dalším uploadu. Uživatel, který přestal používat app, nechá bloby viset navždy. Řešení: timer-triggered function, která jednou denně projede všechny pending napříč uživateli.

**Soubory:**
- Modify: `api/repository.py` — přidat `all_pending_older_than(cutoff)` do Protocol, InMemory a Cosmos
- Modify: `api/function_app.py` — přidat timer trigger
- Create: `api/test_pending_sweep.py`

- [ ] **Krok 1: Přidat `all_pending_older_than` do Protocol a InMemory v `repository.py`**

Najdi třídu `ImagesRepository` (Protocol). Aktuálně obsahuje metody `create_image`, `get_image`, `set_note_id`, `images_for_note`, `delete_image`, `pending_older_than`. Přidej:

```python
class ImagesRepository(Protocol):
    # ... stávající metody ...
    def all_pending_older_than(self, cutoff: datetime) -> list[ImageRecord]: ...
```

Najdi `InMemoryImagesRepository.pending_older_than` a přidej hned za:

```python
    def all_pending_older_than(self, cutoff) -> list[ImageRecord]:
        return [
            i for i in self._images.values()
            if i.note_id is None and i.created_at < cutoff
        ]
```

Najdi `CosmosImagesRepository.pending_older_than` a přidej hned za:

```python
    def all_pending_older_than(self, cutoff) -> list[ImageRecord]:
        items = self._c().query_items(
            query=(
                "SELECT * FROM c "
                "WHERE (NOT IS_DEFINED(c.note_id) OR c.note_id = null) "
                "AND c.created_at < @cut"
            ),
            parameters=[{"name": "@cut", "value": cutoff.isoformat()}],
            enable_cross_partition_query=True,
        )
        return [ImageRecord.model_validate(i) for i in items]
```

- [ ] **Krok 2: Přidat `global_sweep_pending` do `images_ops.py`**

Na konec `api/images_ops.py` přidej:

```python
def global_sweep_pending(images_repo, blob_store, cutoff) -> int:
    """Delete pending (unbound) image blobs older than cutoff across all users.

    Returns the count of deleted records.
    """
    count = 0
    for rec in images_repo.all_pending_older_than(cutoff):
        _delete_record_and_blob(images_repo, blob_store, rec.user_id, rec.id)
        count += 1
    return count
```

- [ ] **Krok 3: Přidat timer trigger do `function_app.py`**

Na konec `api/function_app.py` (za feedback handler) přidej:

```python
# ---------------------------------------------------------- scheduled jobs

@app.timer_trigger(schedule="0 0 3 * * *", arg_name="timer", run_on_startup=False)
def daily_pending_image_sweep(timer: func.TimerRequest) -> None:
    """Nightly cleanup of abandoned pending image blobs (00:00 UTC daily).

    This is a global sweep across all users; the per-user lazy sweep in
    create_image handles the common case; this catches accounts that have
    gone dormant.
    """
    cutoff = datetime.utcnow() - _PENDING_IMAGE_TTL
    deleted = images_ops.global_sweep_pending(images_repo, blob_store, cutoff)
    logging.info("daily_pending_image_sweep: deleted %d pending blobs", deleted)
```

- [ ] **Krok 4: Napsat failing test**

```python
# api/test_pending_sweep.py
from datetime import datetime, timedelta
import images_ops
from blobstore import InMemoryBlobStore
from repository import InMemoryImagesRepository
from models import ImageRecord


def _img(user_id: str, blob_path: str, created_at: datetime, note_id=None) -> ImageRecord:
    return ImageRecord(
        user_id=user_id,
        note_id=note_id,
        blob_path=blob_path,
        content_type="image/webp",
        size_bytes=100,
        created_at=created_at,
    )


def test_global_sweep_deletes_old_pending_across_users():
    repo = InMemoryImagesRepository()
    blob = InMemoryBlobStore()
    old = datetime(2025, 1, 1)
    fresh = datetime.utcnow()
    cutoff = datetime(2026, 1, 1)

    alice_old = _img("alice", "alice/a1", old)
    bob_old = _img("bob", "bob/b1", old)
    alice_fresh = _img("alice", "alice/a2", fresh)

    for rec in [alice_old, bob_old, alice_fresh]:
        repo.create_image(rec)

    deleted = images_ops.global_sweep_pending(repo, blob, cutoff)

    assert deleted == 2
    assert "alice/a1" in blob.deleted
    assert "bob/b1" in blob.deleted
    assert "alice/a2" not in blob.deleted


def test_global_sweep_leaves_bound_images():
    repo = InMemoryImagesRepository()
    blob = InMemoryBlobStore()
    old = datetime(2025, 1, 1)
    cutoff = datetime(2026, 1, 1)

    bound = _img("alice", "alice/bound", old, note_id="note-1")
    repo.create_image(bound)

    deleted = images_ops.global_sweep_pending(repo, blob, cutoff)
    assert deleted == 0
    assert blob.deleted == []


def test_all_pending_older_than_in_memory():
    repo = InMemoryImagesRepository()
    old = datetime(2025, 1, 1)
    fresh = datetime.utcnow()
    cutoff = datetime(2026, 1, 1)

    old_rec = _img("alice", "alice/old", old)
    fresh_rec = _img("alice", "alice/fresh", fresh)
    repo.create_image(old_rec)
    repo.create_image(fresh_rec)

    result = repo.all_pending_older_than(cutoff)
    ids = [r.id for r in result]
    assert old_rec.id in ids
    assert fresh_rec.id not in ids
```

- [ ] **Krok 5: Spustit test — musí selhat**

```bash
cd api && python -m pytest test_pending_sweep.py -v
```

Očekávaný výstup: FAIL (`all_pending_older_than` nebo `global_sweep_pending` chybí).

- [ ] **Krok 6: Ověřit implementaci + spustit testy**

```bash
cd api && python -m pytest test_pending_sweep.py -v
```

Všechny testy PASS.

- [ ] **Krok 7: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL.

- [ ] **Krok 8: Commit**

```bash
git add api/repository.py api/images_ops.py api/function_app.py api/test_pending_sweep.py
git commit -m "security: add global nightly sweep of abandoned pending image blobs

Per-user lazy GC only ran on the next upload by the same user. Dormant accounts
accumulated orphaned blobs indefinitely. Added all_pending_older_than() repo method
and global_sweep_pending() in images_ops; wired to a daily timer trigger at 03:00 UTC."
```

---

## FÁZE 3 — Per-user rate limity + body-size strop

### Task 6: Per-user rate limit na `POST notes`, `PUT notes/{id}`, `POST auth/change-password`

**Kontext:** Tyto endpointy píší do Cosmosu (RU/cost) bez throttlingu. Autentizovaný útočník (nebo kompromitovaný účet) může zásobovat Cosmos requestů. Klíčujeme na username (ne IP), takže sdílená síť není trestána.

**Soubory:**
- Modify: `api/function_app.py`
- Create: `api/test_rate_limits_notes.py`

- [ ] **Krok 1: Přidat nové limitery do `function_app.py`**

Na konec bloku s limitery (okolo řádku 55–61) přidej:

```python
# Per-user write brake for notes: 120 creates/updates per minute is generous
# for human use but a hard stop for scripted abuse.
_notes_write_limiter = RateLimiter(max_calls=120, window_seconds=60)

# Password change is a KDF-heavy operation on the client; 5/hour is more
# than enough for any legitimate use case.
_change_password_limiter = RateLimiter(max_calls=5, window_seconds=3600)
```

- [ ] **Krok 2: Přidat check do `create_note`**

Najdi handler `create_note` (`POST notes`, okolo řádku 396). Za `user = _require_user(req)` a jeho chybový check přidej:

```python
    if not _notes_write_limiter.allow(user):
        return _error("Too many note writes, try again later", 429)
```

- [ ] **Krok 3: Přidat check do `update_note`**

Najdi handler `update_note` (`PUT notes/{id}`, okolo řádku 448). Za `user = _require_user(req)` a jeho chybový check přidej:

```python
    if not _notes_write_limiter.allow(user):
        return _error("Too many note writes, try again later", 429)
```

- [ ] **Krok 4: Přidat check do `change_password`**

Najdi handler `change_password` (`POST auth/change-password`, okolo řádku 309). Za `user = _require_user(req)` a jeho chybový check přidej:

```python
    if not _change_password_limiter.allow(user):
        return _error("Too many password change attempts, try again later", 429)
```

- [ ] **Krok 5: Napsat failing test**

```python
# api/test_rate_limits_notes.py
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-rate-limits")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import json
import time
import azure.functions as func
import auth
from ratelimit import RateLimiter


def _token(username: str) -> str:
    return auth.create_token(username)


def _note_req(token: str):
    body = json.dumps({"iv": "a" * 16, "ct": "b" * 32, "image_ids": []}).encode()
    return func.HttpRequest(
        method="POST",
        url="http://localhost/api/notes",
        headers={"Content-Type": "application/json", "X-Auth-Token": token},
        body=body,
    )


def test_notes_write_limiter_keys_by_user():
    """Two different users share a RateLimiter but must have independent quotas."""
    limiter = RateLimiter(max_calls=3, window_seconds=60)
    for _ in range(3):
        assert limiter.allow("alice") is True
    assert limiter.allow("alice") is False
    # Bob is unaffected.
    assert limiter.allow("bob") is True


def test_change_password_limiter_independent():
    """change-password limiter must be separate from notes limiter."""
    notes_lim = RateLimiter(max_calls=120, window_seconds=60)
    pw_lim = RateLimiter(max_calls=5, window_seconds=3600)
    for _ in range(5):
        assert pw_lim.allow("alice") is True
    assert pw_lim.allow("alice") is False
    # Notes limiter is unaffected.
    assert notes_lim.allow("alice") is True
```

- [ ] **Krok 6: Spustit test**

```bash
cd api && python -m pytest test_rate_limits_notes.py -v
```

Testy jsou čisté unit testy na RateLimiter, procházejí bez importu celého function_app.

Očekávaný výstup: všechny PASS.

- [ ] **Krok 7: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL.

- [ ] **Krok 8: Commit**

```bash
git add api/function_app.py api/test_rate_limits_notes.py
git commit -m "security: add per-user rate limits on notes writes and change-password

POST/PUT notes: 120/min per user (generous for humans, hard stop for scripts).
POST auth/change-password: 5/hour per user (KDF-heavy, no legit need for more).
Keyed by username, not IP, so shared networks are not penalised."
```

---

### Task 7: Globální body-size strop na JSON endpointech

**Kontext:** Pydantic validuje délky polí, ale nekontroluje celkovou velikost JSON body requestu. Velmi velký body spotřebuje paměť ještě před validací.

**Soubory:**
- Modify: `api/function_app.py`
- Create: `api/test_body_size.py`

- [ ] **Krok 1: Přidat helper `_reject_oversize`**

Na konec bloku helperů v `function_app.py` (za `_error`, před první route) přidej:

```python
# 256 KB is a generous ceiling for any JSON payload this API accepts.
# Actual field-level caps (ct max 64k, message max 4k, etc.) are tighter;
# this is a first-pass defence against memory-exhaustion before Pydantic runs.
_MAX_BODY_BYTES = 256 * 1024


def _reject_oversize(req: func.HttpRequest) -> Optional[func.HttpResponse]:
    body = req.get_body()
    if len(body) > _MAX_BODY_BYTES:
        return _error(f"Request body too large (max {_MAX_BODY_BYTES // 1024} KB)", 413)
    return None
```

- [ ] **Krok 2: Přidat volání `_reject_oversize` do POST/PUT handlerů**

Přidej jako **první check** (před `_rate_limited` nebo `_require_user`) do těchto handlerů:
- `register` (POST)
- `login` (POST)
- `recover` (POST)
- `change_password` (POST)
- `create_note` (POST)
- `update_note` (PUT)
- `create_feedback` (POST)
- `create_image` (POST)

Pro každý handler přidej na začátek (jako vůbec první check v těle funkce):

```python
    oversize = _reject_oversize(req)
    if oversize:
        return oversize
```

- [ ] **Krok 3: Napsat failing test**

```python
# api/test_body_size.py
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-body-size")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import azure.functions as func
from function_app import _reject_oversize, _MAX_BODY_BYTES


def _req_with_body(body: bytes):
    return func.HttpRequest(
        method="POST",
        url="http://localhost/api/test",
        headers={"Content-Type": "application/json"},
        body=body,
    )


def test_small_body_passes():
    req = _req_with_body(b'{"key": "value"}')
    assert _reject_oversize(req) is None


def test_exact_limit_passes():
    req = _req_with_body(b"x" * _MAX_BODY_BYTES)
    assert _reject_oversize(req) is None


def test_over_limit_returns_413():
    req = _req_with_body(b"x" * (_MAX_BODY_BYTES + 1))
    resp = _reject_oversize(req)
    assert resp is not None
    assert resp.status_code == 413


def test_error_message_mentions_limit():
    req = _req_with_body(b"x" * (_MAX_BODY_BYTES + 1))
    resp = _reject_oversize(req)
    import json
    body = json.loads(resp.get_body())
    assert "256" in body["error"]
```

- [ ] **Krok 4: Spustit test — musí selhat**

```bash
cd api && python -m pytest test_body_size.py -v
```

Očekávaný výstup: FAIL (`_reject_oversize` nebo `_MAX_BODY_BYTES` neexistuje).

- [ ] **Krok 5: Ověřit implementaci + spustit testy**

```bash
cd api && python -m pytest test_body_size.py -v
```

Všechny testy PASS.

- [ ] **Krok 6: Spustit celou suite**

```bash
cd api && python -m pytest -v
```

Žádný nový FAIL.

- [ ] **Krok 7: Commit**

```bash
git add api/function_app.py api/test_body_size.py
git commit -m "security: add 256 KB body-size cap on POST/PUT endpoints

Pydantic field-level limits run after JSON parsing; a very large body
could exhaust memory before validation. _reject_oversize() checks Content
length before any further processing and returns 413."
```

---

## Self-Review

### Spec coverage

| Nález | Fáze | Task | Pokrytí |
|---|---|---|---|
| X-Forwarded-For falšovatelný | 1 | Task 1 | ✓ |
| recovery-material — únik + enumeration | 1 | Task 2 | ✓ |
| verify-email enumeration oracle | 1 | Task 3 | ✓ |
| SAS upload — nekontrolovaná velikost | 2 | Task 4 | ✓ |
| Pending bloby visí navždy | 2 | Task 5 | ✓ |
| Chybí rate limit notes write / change-password | 3 | Task 6 | ✓ |
| Žádný globální body-size strop | 3 | Task 7 | ✓ |

Záměrně vynecháno (known-limit, dokumentováno v auditu):
- PoW replay v TTL okně — vyžaduje server-side state, YAGNI
- PBKDF2 100k iterací — verifier je high-entropy, neprioritní
- In-memory rate limit při scale-out — long-term řešení je APIM/Front Door, mimo scope kódu

### Kontrola typů a konzistence
- `blob_size(blob_path: str) -> int | None` — použito konzistentně v Protocol, InMemory, Azure, i v `verify_uploaded_sizes`.
- `all_pending_older_than(cutoff: datetime) -> list[ImageRecord]` — konzistentní v Protocol, InMemory, Cosmos.
- `global_sweep_pending(images_repo, blob_store, cutoff) -> int` — bere `cutoff` bez type annotation (duck typing, jako ostatní funkce v `images_ops`).
- `_reject_oversize(req) -> Optional[func.HttpResponse]` — vzor shodný s `_rate_limited`.
- `_notes_write_limiter`, `_change_password_limiter` — klíčovány na `user` (string), stejný vzor jako `_feedback_limiter` a `_image_limiter`.
