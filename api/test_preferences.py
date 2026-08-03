import pytest
from pydantic import ValidationError
from models import PreferencesRequest, User


def test_preferences_accepts_known_values():
    assert PreferencesRequest(sortBy="created").sortBy == "created"
    assert PreferencesRequest(sortBy="modified").sortBy == "modified"


def test_preferences_rejects_unknown_value():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="alphabetical")


def test_preferences_accepts_auto_lock_minutes():
    r = PreferencesRequest(sortBy="created", autoLockMinutes=15)
    assert r.autoLockMinutes == 15


def test_preferences_accepts_auto_lock_zero_never():
    r = PreferencesRequest(sortBy="created", autoLockMinutes=0)
    assert r.autoLockMinutes == 0


def test_preferences_rejects_negative_auto_lock():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="created", autoLockMinutes=-1)


def test_preferences_auto_lock_optional():
    # autoLockMinutes is optional; omitting it is valid
    r = PreferencesRequest(sortBy="created")
    assert r.autoLockMinutes is None


def test_user_auto_lock_default_is_none():
    u = User(
        username="x", salt="s", recovery_salt="rs", auth_hash="h", rec_auth_hash="rh",
        wrapped_data_key_pw={"iv": "iv", "ct": "ct"},
        wrapped_data_key_rec={"iv": "iv", "ct": "ct"},
    )
    assert u.auto_lock_minutes is None
