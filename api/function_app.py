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
    VerifyEmailRequest, PreferencesRequest,
    Feedback, FeedbackRequest,
    ImageCreateRequest,
)
from repository import (
    get_notes_repository, get_users_repository, get_feedback_repository,
    get_images_repository,
)
from blobstore import get_blob_store
import images_ops
from ratelimit import RateLimiter
import auth
import mailer
import pow

_VERIFY_TTL = timedelta(hours=24)
_UNVERIFIED_NOTE_LIMIT = 10  # unverified accounts may have at most this many notes
_VERIFIED_NOTE_LIMIT = 1000  # hard per-account ceiling (bounds Cosmos storage/RU)
_PENDING_IMAGE_TTL = timedelta(hours=24)  # lazy GC horizon for unclaimed image uploads
_DEFAULT_MAX_IMAGES_PER_NOTE = 10  # fallback when the user record can't be read

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

notes_repo = get_notes_repository()
users_repo = get_users_repository()
feedback_repo = get_feedback_repository()
images_repo = get_images_repository()
blob_store = get_blob_store()

# In production set ALLOWED_ORIGIN to your own domain; defaults to '*' in dev.
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
_CORS = {
    "Access-Control-Allow-Origin": _ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
}

# Best-effort brake against brute-force on sensitive auth endpoints.
_auth_limiter = RateLimiter(max_calls=20, window_seconds=60)

# Separate from _auth_limiter on purpose: feedback must not eat the sign-in quota.
# Keyed by username (we know who it is) rather than IP, so a shared network is
# not punished for one chatty user.
_feedback_limiter = RateLimiter(max_calls=5, window_seconds=600)

# Per-user brake on image uploads: generous enough for pasting several
# screenshots in a session, a brake against an authenticated account
# inflating blob storage. The per-image size cap is client-side (see design
# doc); this bounds the upload *rate*.
_image_limiter = RateLimiter(max_calls=60, window_seconds=600)


def _client_ip(req: func.HttpRequest) -> str:
    # Azure SWA/Functions appends the verified client IP as the RIGHTMOST hop in
    # X-Forwarded-For; left-side values are client-supplied and must not be trusted.
    # Taking the first (leftmost) value would allow any client to spoof their IP
    # and bypass rate limiting entirely.
    header = req.headers.get("X-Forwarded-For", "")
    parts = [p.strip() for p in header.split(",") if p.strip()]
    return parts[-1] if parts else "unknown"


def _rate_limited(req: func.HttpRequest) -> Optional[func.HttpResponse]:
    if not _auth_limiter.allow(_client_ip(req)):
        return _error("Too many attempts, try again shortly", 429)
    return None


def _json(payload, status_code: int) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload), mimetype="application/json",
        status_code=status_code, headers=_CORS,
    )


def _error(message: str, status_code: int) -> func.HttpResponse:
    return _json({"error": message}, status_code)


def _require_user(req: func.HttpRequest) -> Union[str, func.HttpResponse]:
    """Return the username from a valid session token, or a 401 response otherwise.

    We take the token from our own X-Auth-Token header (Azure Static Web Apps
    does not pass the Authorization header through to managed functions);
    Authorization Bearer remains as a fallback for direct API calls.
    """
    token = req.headers.get("X-Auth-Token", "")
    if not token:
        header = req.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
    username = auth.verify_token(token)
    if not username:
        return _error("Not signed in", 401)
    return username


def _prepare_verification(user: User) -> Optional[str]:
    """Set a one-time verification token on the user; return the link to send."""
    if not user.email:
        return None
    token = auth.new_verification_token()
    user.verify_token_hash = auth.token_hash(token)
    user.verify_expires = datetime.utcnow() + _VERIFY_TTL
    return f"{mailer.base_url()}/verify?user={quote(user.username)}&token={quote(token)}"


def _maybe_send_verification(user: User) -> None:
    """Send a verification email, only when the user has no valid token (anti-spam)."""
    if not user.email:
        return
    if (
        user.verify_token_hash
        and user.verify_expires
        and datetime.utcnow() < user.verify_expires
    ):
        return  # active token -> don't resend
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
        return _error("Missing username", 400)
    return _json(pow.issue_challenge(username), 200)


@app.route(route="auth/register", methods=["POST"])
def register(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    try:
        data = RegisterRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    if not data.username.strip():
        return _error("Missing username", 400)
    if not pow.verify_solution(data.powChallenge, data.powNonce, data.username):
        return _error("Anti-bot check failed, please try registering again.", 403)
    email = data.email.strip().lower()
    if "@" not in email or "." not in email:
        return _error("Invalid e-mail", 400)
    # Atomic email reservation (create in email_index) - also closes concurrent registrations.
    if not users_repo.reserve_email(email, data.username):
        return _error("That e-mail is already registered", 409)

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
        users_repo.release_email(email)  # rollback the reservation
        return _error("That username is taken", 409)
    return _json(
        {"token": auth.create_token(user.username), "emailVerified": user.email_verified},
        201,
    )


@app.route(route="auth/salt", methods=["GET"])
def get_salt(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
    user = users_repo.get_user(username)
    # For a non-existent user we return a deterministic fake salt (anti-enumeration).
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
        return _error(f"Invalid data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None or not auth.verify_verifier(data.authVerifier, user.auth_hash):
        return _error("Wrong username or password", 401)
    # Backfill the email index for accounts created before it was introduced (best-effort).
    if user.email:
        try:
            users_repo.index_email(user.email, user.username)
        except Exception:
            logging.warning("Email index backfill failed for %s", user.username)
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
        return _error(f"Invalid data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None:
        # Do not reveal whether the username exists (anti-enumeration).
        return _error("The link is invalid or expired", 400)
    if user.email_verified:
        return _json({"verified": True}, 200)
    if (
        not user.verify_token_hash
        or not user.verify_expires
        or datetime.utcnow() > user.verify_expires
        or not auth.verify_token_hash(data.token, user.verify_token_hash)
    ):
        return _error("The link is invalid or expired", 400)

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
        return _error("Nothing to verify", 400)
    if user.email_verified:
        return _json({"verified": True}, 200)
    link = _prepare_verification(user)
    users_repo.save_user(user)
    if link:
        mailer.send_verification_email(user.email, link)
    return _json({"sent": True}, 200)


@app.route(route="auth/recovery-material", methods=["GET"])
def recovery_material(req: func.HttpRequest) -> func.HttpResponse:
    limited = _rate_limited(req)
    if limited:
        return limited
    username = req.params.get("username", "")
    user = users_repo.get_user(username)
    if user is None:
        # Return a deterministic decoy so the caller cannot distinguish a missing
        # account from an existing one (anti-enumeration, same pattern as auth/salt).
        return _json(auth.decoy_recovery_material(username), 200)
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
        return _error(f"Invalid data: {str(e)}", 400)

    user = users_repo.get_user(data.username)
    if user is None or not auth.verify_verifier(data.recAuthVerifier, user.rec_auth_hash):
        return _error("Invalid recovery code", 401)

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
        return _error(f"Invalid data: {str(e)}", 400)

    user = users_repo.get_user(username)
    if user is None:
        return _error("User not found", 404)
    user.salt = data.newSalt
    user.auth_hash = auth.hash_verifier(data.newAuthVerifier)
    user.wrapped_data_key_pw = data.newWrappedDataKeyPw
    users_repo.save_user(user)
    return func.HttpResponse(status_code=204, headers=_CORS)


@app.route(route="auth/me", methods=["GET"])
def me(req: func.HttpRequest) -> func.HttpResponse:
    username = _require_user(req)
    if isinstance(username, func.HttpResponse):
        return username
    user = users_repo.get_user(username)
    if user is None:
        return _error("User not found", 404)
    return _json(
        {
            "username": user.username,
            "email": user.email,
            "emailVerified": user.email_verified,
            "createdAt": user.created_at.isoformat() if user.created_at else None,
            "sortBy": user.sort_by,
            "maxImagesPerNote": user.max_images_per_note,
            "autoLockMinutes": user.auto_lock_minutes,
        },
        200,
    )


@app.route(route="auth/preferences", methods=["PUT"])
def update_preferences(req: func.HttpRequest) -> func.HttpResponse:
    username = _require_user(req)
    if isinstance(username, func.HttpResponse):
        return username
    try:
        data = PreferencesRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    user = users_repo.get_user(username)
    if user is None:
        return _error("User not found", 404)
    user.sort_by = data.sortBy
    if data.autoLockMinutes is not None:
        user.auto_lock_minutes = data.autoLockMinutes
    users_repo.save_user(user)
    return _json({"sortBy": user.sort_by, "autoLockMinutes": user.auto_lock_minutes}, 200)


def _note_limit_hit(count: int, verified: bool) -> Optional[str]:
    """Which cap creating one more note would breach: 'unverified', 'hard', or None."""
    if not verified and count >= _UNVERIFIED_NOTE_LIMIT:
        return "unverified"
    if count >= _VERIFIED_NOTE_LIMIT:
        return "hard"
    return None


def _image_limit(user: Optional[User]) -> int:
    """The user's images-per-note quota; hand-edited in Cosmos, never via the API."""
    return user.max_images_per_note if user else _DEFAULT_MAX_IMAGES_PER_NOTE


def _image_limit_exceeded(image_ids, limit: int) -> bool:
    """Distinct ids: the same picture used repeatedly in one note counts once."""
    return len(set(image_ids)) > limit


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
        return _error(f"Invalid data: {str(e)}", 400)

    # Note caps: unverified accounts get a low bot-brake ceiling; every account
    # has a hard ceiling that bounds per-account Cosmos storage/RU.
    account = users_repo.get_user(user)
    verified = account.email_verified if account is not None else False
    hit = _note_limit_hit(notes_repo.count_notes(user), verified)
    if hit == "unverified":
        if account is not None:
            _maybe_send_verification(account)
        return _error(
            f"Verify your e-mail for more than {_UNVERIFIED_NOTE_LIMIT} notes.", 403
        )
    if hit == "hard":
        return _error("Note limit reached", 403)

    limit = _image_limit(account)
    if _image_limit_exceeded(data.image_ids, limit):
        return _error(f"A note can hold at most {limit} images.", 403)

    note = Note(
        user_id=user,
        iv=data.iv,
        ct=data.ct,
        **({"created_at": data.created_at} if data.created_at else {}),
    )
    # A new note's modification time starts equal to its creation time.
    note.updated_at = note.created_at
    notes_repo.save_note(note)
    images_ops.reconcile_note(images_repo, blob_store, user, note.id, data.image_ids)
    return _json(note.model_dump(mode="json"), 201)


@app.route(route="notes/{id}", methods=["GET"])
def get_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    note = notes_repo.get_note(user, req.route_params.get("id"))
    if note is None:
        return _error("Note not found", 404)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["PUT"])
def update_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    note = notes_repo.get_note(user, req.route_params.get("id"))
    if note is None:
        return _error("Note not found", 404)
    try:
        data = NoteCreate(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)

    limit = _image_limit(users_repo.get_user(user))
    if _image_limit_exceeded(data.image_ids, limit):
        return _error(f"A note can hold at most {limit} images.", 403)

    note.iv = data.iv
    note.ct = data.ct
    note.updated_at = datetime.utcnow()
    notes_repo.save_note(note)
    images_ops.reconcile_note(images_repo, blob_store, user, note.id, data.image_ids)
    return _json(note.model_dump(mode="json"), 200)


@app.route(route="notes/{id}", methods=["DELETE"])
def delete_note(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    note_id = req.route_params.get("id")
    if not notes_repo.delete_note(user, note_id):
        return _error("Note not found", 404)
    images_ops.cascade_delete_note(images_repo, blob_store, user, note_id)
    return func.HttpResponse(status_code=204, headers=_CORS)


# ---------------------------------------------------------------- images

@app.route(route="images", methods=["POST"])
def create_image(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    if not _image_limiter.allow(user):
        return _error("Too many uploads, try again later", 429)
    try:
        data = ImageCreateRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    # Lazy GC: clear this user's abandoned pending uploads on the way in.
    images_ops.sweep_pending(images_repo, blob_store, user, datetime.utcnow() - _PENDING_IMAGE_TTL)
    result = images_ops.issue_upload(images_repo, blob_store, user, data.content_type, data.size_bytes)
    return _json(result, 201)


@app.route(route="images/{id}/url", methods=["GET"])
def image_url(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    url = images_ops.issue_read_url(images_repo, blob_store, user, req.route_params.get("id"))
    if url is None:
        return _error("Image not found", 404)
    return _json({"url": url}, 200)


# ------------------------------------------------------------- feedback

def _notify_feedback(username: str, message: str) -> None:
    """Look up the sender's e-mail and notify the owner. Best-effort throughout:
    the feedback is stored before this runs, so nothing here may fail the request.

    The two steps are guarded separately on purpose: a failed lookup must still
    send the notification (without an address), because the notification is also
    what writes the message to the log when no mail provider is configured.
    """
    email = None
    try:
        user = users_repo.get_user(username)
        email = user.email if user else None
    except Exception:  # noqa: BLE001 - a notification without an address beats none
        logging.exception("Could not load user %s for the feedback notification", username)
    try:
        mailer.send_feedback_notification(username, email, message)
    except Exception:  # noqa: BLE001 - the feedback is already stored; a 500 here would be a lie
        logging.exception("Feedback notification failed for %s", username)


@app.route(route="feedback", methods=["POST"])
def create_feedback(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
    if not _feedback_limiter.allow(user):
        return _error("Too many messages, try again later", 429)
    try:
        data = FeedbackRequest(**req.get_json())
    except Exception as e:
        return _error(f"Invalid data: {str(e)}", 400)
    # Store first, notify second: mailer is best-effort, so e-mail must never be
    # the only record of the message.
    feedback_repo.add_feedback(Feedback(user_id=user, message=data.message))
    _notify_feedback(user, data.message)
    return _json({"ok": True}, 201)
