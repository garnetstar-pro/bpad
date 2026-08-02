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
import secrets
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
    if key:
        return key
    # Fail in production without a configured key (otherwise tokens could be forged).
    # Dev fallback only locally, where the Functions runtime reports "Development".
    if os.environ.get("AZURE_FUNCTIONS_ENVIRONMENT") == "Development":
        logging.warning("SESSION_SIGNING_KEY is not set - using dev fallback.")
        return "dev-only-insecure-signing-key-change-me-in-prod"
    raise RuntimeError("SESSION_SIGNING_KEY must be set (used to sign session tokens)")


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


# --- email verification token (one-time use, only its hash is stored) ---
def new_verification_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token_hash(token: str, stored: str) -> bool:
    return hmac.compare_digest(token_hash(token), stored)


# Deterministic "fake" salt for non-existent users (to prevent enumeration).
def decoy_salt(username: str) -> str:
    mac = hmac.new(_signing_key().encode(), username.encode(), hashlib.sha256).digest()
    return _b64(mac[:16])


def decoy_recovery_material(username: str) -> dict:
    """Return stable fake recovery material for a non-existent username.

    Uses separate HMAC tags (different contexts) so the decoy iv and ct have
    the same shape as real Encrypted values but are deterministically derived
    from the username, making user-existence enumeration via this endpoint
    impossible (same anti-enumeration pattern as decoy_salt for auth/salt).
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
