import os

# Deterministický podpisový klíč pro testy (produkce ho bere z prostředí).
os.environ.setdefault("SESSION_SIGNING_KEY", "test-signing-key-that-is-long-enough-1234")
# PoW vypnutý v testech, pokud si test nenastaví vlastní obtížnost.
os.environ.setdefault("POW_DIFFICULTY", "0")
