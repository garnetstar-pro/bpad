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
