"""Tests that verify-email endpoint does not leak user existence via different error messages."""
import os
os.environ.setdefault("SESSION_SIGNING_KEY", "test-key-verify-email")
os.environ.setdefault("AZURE_FUNCTIONS_ENVIRONMENT", "Development")

import json
from datetime import datetime, timedelta
import azure.functions as func

import function_app  # noqa: F401 - registers routes as side effect
from function_app import verify_email, users_repo
from models import User
import auth


def _make_req(username: str, token: str):
    body = json.dumps({"username": username, "token": token}).encode()
    return func.HttpRequest(
        method="POST",
        url="http://localhost/api/auth/verify-email",
        headers={"Content-Type": "application/json"},
        body=body,
    )


def _make_user_with_token(username: str) -> None:
    u = User(
        username=username, salt="s", recovery_salt="rs",
        auth_hash="h", rec_auth_hash="rh",
        wrapped_data_key_pw={"iv": "iv", "ct": "ct"},
        wrapped_data_key_rec={"iv": "iv", "ct": "ct"},
    )
    u.verify_token_hash = auth.token_hash("validtoken")
    u.verify_expires = datetime.utcnow() + timedelta(hours=1)
    users_repo.save_user(u)


def test_nonexistent_user_returns_400_not_404():
    """Non-existent user must NOT return 404 (user existence oracle)."""
    req = _make_req("no-such-user-xyzzy", "some-token")
    resp = verify_email(req)
    assert resp.status_code == 400


def test_missing_user_and_bad_token_same_message():
    """Error message must be identical whether user missing or token wrong.

    This prevents user enumeration: an attacker cannot tell from the error
    whether the account exists at all.
    """
    _make_user_with_token("existing-user-enum-test")

    req_missing = _make_req("no-such-user-xyzzy-enum", "wrongtok")
    req_bad_tok = _make_req("existing-user-enum-test", "wrongtok")

    r_missing = verify_email(req_missing)
    r_bad_tok = verify_email(req_bad_tok)

    assert r_missing.status_code == r_bad_tok.status_code == 400
    msg_missing = json.loads(r_missing.get_body())["error"]
    msg_bad_tok = json.loads(r_bad_tok.get_body())["error"]
    assert msg_missing == msg_bad_tok


def test_error_mentions_invalid_or_expired():
    """Error message must mention the link being invalid or expired."""
    req = _make_req("no-such-user-xyzzy", "tok")
    resp = verify_email(req)
    body = json.loads(resp.get_body())
    assert "invalid" in body["error"].lower() or "expired" in body["error"].lower()
