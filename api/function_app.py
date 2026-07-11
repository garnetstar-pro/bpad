import azure.functions as func
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional, Union
from urllib.parse import quote

from models import (
    Note, NoteCreate, User,
    RegisterRequest, LoginRequest, RecoverRequest, ChangePasswordRequest,
    VerifyEmailRequest,
)
from repository import get_notes_repository, get_users_repository
from ratelimit import RateLimiter
import auth
import mailer
import pow

_VERIFY_TTL = timedelta(hours=24)
_UNVERIFIED_NOTE_LIMIT = 10  # neověřené účty smí max tolik poznámek

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

notes_repo = get_notes_repository()
users_repo = get_users_repository()

# V produkci nastav ALLOWED_ORIGIN na vlastní doménu; v devu default '*'.
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
_CORS = {
    "Access-Control-Allow-Origin": _ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
}

# Best-effort brzda proti brute-force na citlivé auth endpointy.
_auth_limiter = RateLimiter(max_calls=20, window_seconds=60)


def _client_ip(req: func.HttpRequest) -> str:
    return req.headers.get("X-Forwarded-For", "").split(",")[0].strip() or "unknown"


def _rate_limited(req: func.HttpRequest) -> Optional[func.HttpResponse]:
    if not _auth_limiter.allow(_client_ip(req)):
        return _error("Příliš mnoho pokusů, zkus to za chvíli", 429)
    return None


def _json(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload), mimetype="application/json",
        status_code=status_code, headers=_CORS,
    )


def _error(message: str, status_code: int) -> func.HttpResponse:
    return _json({"error": message}, status_code)


def _require_user(req: func.HttpRequest) -> Union[str, func.HttpResponse]:
    """Vrátí username z platného session tokenu, jinak 401 odpověď.

    Token bereme z vlastní hlavičky X-Auth-Token (Azure Static Web Apps
    hlavičku Authorization do managed functions nepropouští); Authorization
    Bearer zůstává jako fallback pro přímé volání API.
    """
    token = req.headers.get("X-Auth-Token", "")
    if not token:
        header = req.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
    username = auth.verify_token(token)
    if not username:
        return _error("Nepřihlášeno", 401)
    return username


def _prepare_verification(user: User) -> Optional[str]:
    """Nastaví jednorázový ověřovací token na uživatele; vrátí odkaz k odeslání."""
    if not user.email:
        return None
    token = auth.new_verification_token()
    user.verify_token_hash = auth.token_hash(token)
    user.verify_expires = datetime.utcnow() + _VERIFY_TTL
    return f"{mailer.base_url()}/verify?user={quote(user.username)}&token={quote(token)}"


def _maybe_send_verification(user: User) -> None:
    """Pošle ověřovací e-mail, jen když uživatel nemá platný token (anti-spam)."""
    if not user.email:
        return
    if (
        user.verify_token_hash
        and user.verify_expires
        and datetime.utcnow() < user.verify_expires
    ):
        return  # aktivní token → neposílat znovu
    link = _prepare_verification(user)
    users_repo.save_user(user)
    if link:
        mailer.send_verification_email(user.email, link)


# ----------------------------------------------------------------- auth

@app.route(route="auth/pow-challenge", methods=["GET"])
def pow_challenge(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
    if not username.strip():
        return _error("Chybí uživatelské jméno", 400)
    return _json(pow.issue_challenge(username), 200)


@app.route(route="auth/register", methods=["POST"])
def register(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = RegisterRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)
    if not data.username.strip():
        return _error("Chybí uživatelské jméno", 400)
    if not pow.verify_solution(data.powChallenge, data.powNonce, data.username):
        return _error("Ověření proti robotům selhalo, zkus registraci znovu.", 403)
    email = data.email.strip().lower()
    if "@" not in email or "." not in email:
        return _error("Neplatný e-mail", 400)
    # Atomická rezervace e-mailu (create v email_index) – zavře i souběžné registrace.
    if not users_repo.reserve_email(email, data.username):
        return _error("E-mail je už registrovaný", 409)

    user = User(
        username=data.username,
        email=email,
        salt=data.salt,
        recovery_salt=data.recoverySalt,
        auth_hash=auth.hash_verifier(data.authVerifier),
        rec_auth_hash=auth.hash_verifier(data.recAuthVerifier),
        wrapped_data_key_pw=data.wrappedDataKeyPw,
        wrapped_data_key_rec=data.wrappedDataKeyRec,
    )
    if not users_repo.add_user(user):
        users_repo.release_email(email)  # rollback rezervace
        return _error("Uživatelské jméno je obsazené", 409)
    return _json(
        {"token": auth.create_token(user.username), "emailVerified": user.email_verified},
        201,
    )


@app.route(route="auth/salt", methods=["GET"])
def get_salt(req: func.HttpRequest) -> func.HttpResponse:
    username = req.params.get("username", "")
    user = users_repo.get_user(username)
    # Neexistujícímu uživateli vrátíme deterministickou falešnou sůl (anti-enumerace).
    salt = user.salt if user else auth.decoy_salt(username)
    return _json({"salt": salt}, 200)


@app.route(route="auth/login", methods=["POST"])
def login(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = LoginRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None or not auth.verify_verifier(data.authVerifier, user.auth_hash):
        return _error("Špatné jméno nebo heslo", 401)
    # Backfill email indexu pro účty vytvořené před jeho zavedením (best-effort).
    if user.email:
        try:
            users_repo.index_email(user.email, user.username)
        except Exception:
            logging.warning("Backfill email indexu selhal pro %s", user.username)
    return _json(
        {"token": auth.create_token(user.username),
         "wrappedDataKeyPw": user.wrapped_data_key_pw.model_dump(),
         "emailVerified": user.email_verified},
        200,
    )


@app.route(route="auth/verify-email", methods=["POST"])
def verify_email(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = VerifyEmailRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None:
        return _error("Neplatný odkaz", 400)
    if user.email_verified:
        return _json({"verified": True}, 200)
    if (
        not user.verify_token_hash
        or not user.verify_expires
        or datetime.utcnow() > user.verify_expires
        or not auth.verify_token_hash(data.token, user.verify_token_hash)
    ):
        return _error("Odkaz je neplatný nebo vypršel", 400)

    user.email_verified = True
    user.verify_token_hash = None
    user.verify_expires = None
    users_repo.save_user(user)
    return _json({"verified": True}, 200)


@app.route(route="auth/send-verification", methods=["POST"])
def send_verification(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = _require_user(req)
    if isinstance(username, func.HttpResponse):
        return username
    user = users_repo.get_user(username)
    if user is None or not user.email:
        return _error("Není co ověřovat", 400)
    if user.email_verified:
        return _json({"verified": True}, 200)
    link = _prepare_verification(user)
    users_repo.save_user(user)
    if link:
        mailer.send_verification_email(user.email, link)
    return _json({"sent": True}, 200)


@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    user = users_repo.get_user(req.params.get("username", ""))
    if user is None:
        return _error("Uživatel nenalezen", 404)
    return _json(
        {"recoverySalt": user.recovery_salt,
         "wrappedDataKeyRec": user.wrapped_data_key_rec.model_dump()},
        200,
    )


@app.route(route="auth/recover", methods=["POST"])
def recover(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = RecoverRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None or not auth.verify_verifier(data.recAuthVerifier, user.rec_auth_hash):
        return _error("Neplatný recovery kód", 401)

    user.salt = data.newSalt
    user.auth_hash = auth.hash_verifier(data.newAuthVerifier)
    user.wrapped_data_key_pw = data.newWrappedDataKeyPw
    users_repo.save_user(user)
    return _json(
        {"token": auth.create_token(user.username),
         "wrappedDataKeyPw": user.wrapped_data_key_pw.model_dump()},
        200,
    )


@app.route(route="auth/change-password", methods=["POST"])
def change_password(req: func.HttpRequest) -> func.HttpResponse:
    username = _require_user(req)
    if isinstance(username, func.HttpResponse):
        return username
    try:
        data = ChangePasswordRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    user = users_repo.get_user(username)
    if user is None:
        return _error("Uživatel nenalezen", 404)
    user.salt = data.newSalt
    user.auth_hash = auth.hash_verifier(data.newAuthVerifier)
    user.wrapped_data_key_pw = data.newWrappedDataKeyPw
    users_repo.save_user(user)
    return func.HttpResponse(status_code=204, headers=_CORS)


# ---------------------------------------------------------------- notes

@app.route(route="notes", methods=["GET"])
def get_notes(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    return _json([n.model_dump(mode="json") for n in notes_repo.list_notes(user)], 200)


@app.route(route="notes", methods=["POST"])
def create_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    try:
        data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    # Soft-gate: neověřený účet má strop na počet poznámek (brzda pro boty).
    account = users_repo.get_user(user)
    if (
        account is not None
        and not account.email_verified
        and notes_repo.count_notes(user) >= _UNVERIFIED_NOTE_LIMIT
    ):
        _maybe_send_verification(account)
        return _error(
            f"Ověř svůj e-mail pro víc než {_UNVERIFIED_NOTE_LIMIT} poznámek.", 403
        )

    note = Note(user_id=user, iv=data.iv, ct=data.ct)
    notes_repo.save_note(note)
    return _json(note.model_dump(mode="json"), 201)


@app.route(route="notes/{id}", methods=["GET"])
def get_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    note = notes_repo.get_note(user, req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["PUT"])
def update_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    note = notes_repo.get_note(user, req.route_params.get("id"))
    if note is None:
        return _error("Poznámka nenalezena", 404)
    try:
        data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    note.iv = data.iv
    note.ct = data.ct
    notes_repo.save_note(note)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["DELETE"])
def delete_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    if not notes_repo.delete_note(user, req.route_params.get("id")):
        return _error("Poznámka nenalezena", 404)
    return func.HttpResponse(status_code=204, headers=_CORS)
