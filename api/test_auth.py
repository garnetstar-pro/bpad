import auth


def test_verifier_hash_round_trip():
    stored = auth.hash_verifier("dGhlIGF1dGgga2V5")
    assert auth.verify_verifier("dGhlIGF1dGgga2V5", stored) is True


def test_verifier_rejects_wrong_value():
    stored = auth.hash_verifier("correct-verifier")
    assert auth.verify_verifier("wrong-verifier", stored) is False


def test_verifier_hash_is_salted():
    a = auth.hash_verifier("same")
    b = auth.hash_verifier("same")
    assert a != b  # different salt each time
    assert auth.verify_verifier("same", a)
    assert auth.verify_verifier("same", b)


def test_token_round_trip():
    token = auth.create_token("alice")
    assert auth.verify_token(token) == "alice"


def test_verify_token_rejects_garbage():
    assert auth.verify_token("not-a-jwt") is None


def test_verify_token_rejects_tampered_signature():
    token = auth.create_token("alice")
    tampered = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")
    assert auth.verify_token(tampered) is None


def test_verify_token_rejects_expired():
    token = auth.create_token("alice", ttl_seconds=-1)
    assert auth.verify_token(token) is None
