from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid


class Encrypted(BaseModel):
    iv: str
    ct: str


class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    # Klientem zašifrovaný payload {title, content, url}. Server obsah nevidí.
    iv: str
    ct: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class NoteCreate(BaseModel):
    iv: str
    ct: str


class User(BaseModel):
    username: str
    salt: str
    recovery_salt: str
    auth_hash: str
    rec_auth_hash: str
    wrapped_data_key_pw: Encrypted
    wrapped_data_key_rec: Encrypted
    # E-mail je ne-tajné metadata (nešifruje se). Ověření kontroluje vlastnictví.
    email: Optional[str] = None
    email_verified: bool = False
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
