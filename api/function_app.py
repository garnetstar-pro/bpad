import azure.functions as func
import json
import logging
from typing import Union

from models import (
    Note, NoteCreate, User,
    RegisterRequest, LoginRequest, RecoverRequest, ChangePasswordRequest,
)
from titles import resolve_title
from repository import get_notes_repository, get_users_repository
import auth

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

notes_repo = get_notes_repository()
users_repo = get_users_repository()

_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
}


def _json(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload), mimetype="application/json",
        status_code=status_code, headers=_CORS,
    )


def _error(message: str, status_code: int) -> func.HttpResponse:
    return _json({"error": message}, status_code)


def _require_user(req: func.HttpRequest) -> Union[str, func.HttpResponse]:
    """Vrátí username z platného Bearer tokenu, jinak 401 odpověď."""
    header = req.headers.get("Authorization", "")
    token = header[7:] if header.startswith("Bearer ") else ""
    username = auth.verify_token(token)
    if not username:
        return _error("Nepřihlášeno", 401)
    return username


# ----------------------------------------------------------------- auth

@app.route(route="auth/register", methods=["POST"])
def register(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = RegisterRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)
    if not data.username.strip():
        return _error("Chybí uživatelské jméno", 400)

    user = User(
        username=data.username,
        salt=data.salt,
        recovery_salt=data.recoverySalt,
        auth_hash=auth.hash_verifier(data.authVerifier),
        rec_auth_hash=auth.hash_verifier(data.recAuthVerifier),
        wrapped_data_key_pw=data.wrappedDataKeyPw,
        wrapped_data_key_rec=data.wrappedDataKeyRec,
    )
    if not users_repo.add_user(user):
        return _error("Uživatelské jméno je obsazené", 409)
    return _json({"token": auth.create_token(user.username)}, 201)


@app.route(route="auth/salt", methods=["GET"])
def get_salt(req: func.HttpRequest) -> func.HttpResponse:
    username = req.params.get("username", "")
    user = users_repo.get_user(username)
    # Neexistujícímu uživateli vrátíme deterministickou falešnou sůl (anti-enumerace).
    salt = user.salt if user else auth.decoy_salt(username)
    return _json({"salt": salt}, 200)


@app.route(route="auth/login", methods=["POST"])
def login(req: func.HttpRequest) -> func.HttpResponse:
    try:
        data = LoginRequest(**req.get_json())
    except Exception as e:
        return _error(f"Neplatná data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None or not auth.verify_verifier(data.authVerifier, user.auth_hash):
        return _error("Špatné jméno nebo heslo", 401)
    return _json(
        {"token": auth.create_token(user.username),
         "wrappedDataKeyPw": user.wrapped_data_key_pw.model_dump()},
        200,
    )


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

    note = Note(
        user_id=user,
        title=resolve_title(data.title, data.content),
        content=data.content,
        url=data.url,
    )
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

    note.content = data.content
    note.title = resolve_title(data.title, data.content)
    note.url = data.url
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
