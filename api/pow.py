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
