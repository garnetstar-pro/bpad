import os

# Deterministic signing key for tests (production takes it from the environment).
os.environ.setdefault("SESSION_SIGNING_KEY", "test-signing-key-that-is-long-enough-1234")
# PoW disabled in tests, unless a test sets its own difficulty.
os.environ.setdefault("POW_DIFFICULTY", "0")
