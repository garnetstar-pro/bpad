"""Server-side auth helpers: verifier hashing and session tokens.

The server never sees passwords. Clients send a high-entropy *verifier*
(derived from the password via Argon2id+HKDF on the client); we store only a
salted hash of it and issue short-lived signed session tokens.
"""
import base64
import hashlib
import hmac
import logging
import os
import time

import jwt

_PBKDF2_ITERATIONS = 100_000
_TOKEN_TTL_SECONDS = 8 * 60 * 60


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def _unb64(text: str) -> bytes:
    return base64.b64decode(text)


def hash_verifier(verifier: str) -> str:
    """Return a salted PBKDF2 hash string ("salt$hash") for a client verifier."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", verifier.encode(), salt, _PBKDF2_ITERATIONS)
    return f"{_b64(salt)}${_b64(dk)}"


def verify_verifier(verifier: str, stored: str) -> bool:
    """Constant-time check of a verifier against a stored salted hash."""
    try:
        salt_b64, hash_b64 = stored.split("$", 1)
        expected = _unb64(hash_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256", verifier.encode(), _unb64(salt_b64), _PBKDF2_ITERATIONS
        )
    except Exception:
        return False
    return hmac.compare_digest(actual, expected)


def _signing_key() -> str:
    key = os.environ.get("SESSION_SIGNING_KEY")
    if not key:
        logging.warning(
            "SESSION_SIGNING_KEY není nastaven – používám vývojový klíč "
            "(NEPOUŽÍVAT v produkci)."
        )
        key = "dev-only-insecure-signing-key-change-me-in-prod"
    return key


def create_token(username: str, ttl_seconds: int = _TOKEN_TTL_SECONDS) -> str:
    now = int(time.time())
    payload = {"sub": username, "iat": now, "exp": now + ttl_seconds}
    return jwt.encode(payload, _signing_key(), algorithm="HS256")


def verify_token(token: str) -> str | None:
    """Return the username from a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, _signing_key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


# Deterministická „falešná" sůl pro neexistující uživatele (proti enumeraci).
def decoy_salt(username: str) -> str:
    mac = hmac.new(_signing_key().encode(), username.encode(), hashlib.sha256).digest()
    return _b64(mac[:16])
