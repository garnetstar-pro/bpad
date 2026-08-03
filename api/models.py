from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime
import uuid


class Encrypted(BaseModel):
    iv: str
    ct: str


class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # Client-encrypted payload {title, content, url}. The server never sees the content.
    iv: str
    ct: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Server-set metadata: last modification time. Optional so notes stored before
    # this field existed load cleanly; consumers fall back to created_at when None.
    updated_at: Optional[datetime] = None


class ImageRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # None = "pending": the blob is uploaded but the owning note isn't saved yet.
    note_id: Optional[str] = None
    blob_path: str
    content_type: str
    size_bytes: int
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ImageCreateRequest(BaseModel):
    # The client sends the processed image's metadata; the bytes are PUT straight
    # to Blob Storage via the returned SAS URL. 10 MiB is a hard input ceiling.
    content_type: str = Field(max_length=100)
    size_bytes: int = Field(gt=0, le=10 * 1024 * 1024)


class NoteCreate(BaseModel):
    # Length caps bound per-note Cosmos storage/RU. ct is Base64 ciphertext:
    # 65536 chars ~= 48 KB encrypted ~= ~45 KB plaintext. iv is a 12-byte nonce
    # (~16 chars); 64 is headroom.
    iv: str = Field(max_length=64)
    ct: str = Field(max_length=65536)
    # Optional: preserve an original timestamp on import; otherwise server-set.
    created_at: Optional[datetime] = None
    # IDs of images (bpad-img:ID) the note's markdown references. The server can't
    # read the encrypted content, so the client reports them for lifecycle/cleanup.
    image_ids: list[str] = Field(default_factory=list, max_length=100)


class User(BaseModel):
    username: str
    salt: str
    recovery_salt: str
    auth_hash: str
    rec_auth_hash: str
    wrapped_data_key_pw: Encrypted
    wrapped_data_key_rec: Encrypted
    # Email is non-secret metadata (not encrypted). Verification confirms ownership.
    email: Optional[str] = None
    email_verified: bool = False
    # Non-secret UI preference: note-list sort field. "created" (default) | "modified".
    sort_by: str = "created"
    # Non-secret UI preference: idle-lock timeout in minutes. 0 = never; None = not
    # set by user yet (device picks its own default: 5 min on desktop, never on mobile).
    auto_lock_minutes: Optional[int] = None
    # Non-secret per-user quota: how many distinct images one note may reference.
    # Deliberately not writable through any endpoint — change it by hand in the
    # Cosmos `users` container (Azure Data Explorer).
    max_images_per_note: int = 10
    verify_token_hash: Optional[str] = None
    verify_expires: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RegisterRequest(BaseModel):
    username: str
    email: str
    salt: str
    recoverySalt: str
    authVerifier: str
    recAuthVerifier: str
    wrappedDataKeyPw: Encrypted
    wrappedDataKeyRec: Encrypted
    powChallenge: str
    powNonce: str


class VerifyEmailRequest(BaseModel):
    username: str
    token: str


class LoginRequest(BaseModel):
    username: str
    authVerifier: str


class RecoverRequest(BaseModel):
    username: str
    recAuthVerifier: str
    newSalt: str
    newAuthVerifier: str
    newWrappedDataKeyPw: Encrypted


class ChangePasswordRequest(BaseModel):
    newSalt: str
    newAuthVerifier: str
    newWrappedDataKeyPw: Encrypted


class PreferencesRequest(BaseModel):
    sortBy: Literal["created", "modified"]
    # Optional: only present when the user changes the auto-lock setting.
    # 0 = never; None = not sent (don't change the stored value); positive int = minutes.
    autoLockMinutes: Optional[int] = Field(default=None, ge=0)


class Feedback(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # Deliberately NOT encrypted (no iv/ct like Note): this message is written
    # for the app's owner to read. The UI tells the user so.
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FeedbackRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
