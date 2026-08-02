import json

import azure.functions as func

import auth
import function_app as fa
from models import Encrypted, User


def _req(method, url, body=None, token=None, route_params=None):
    headers = {"X-Auth-Token": token} if token else {}
    return func.HttpRequest(
        method=method, url=url, headers=headers, route_params=route_params or {},
        body=json.dumps(body).encode() if body is not None else None,
    )


def _add_user(username, **kw):
    """Register a user directly in the repository, bypassing the register route."""
    enc = Encrypted(iv="i", ct="c")
    user = User(
        username=username,
        salt="s",
        recovery_salt="rs",
        auth_hash="ah",
        rec_auth_hash="rah",
        wrapped_data_key_pw=enc,
        wrapped_data_key_rec=enc,
        **kw,
    )
    fa.users_repo.add_user(user)
    return user


def test_user_defaults_to_ten_images_per_note():
    assert _add_user("lim-default").max_images_per_note == 10


def test_me_reports_the_default_limit():
    _add_user("lim-me-default")
    res = fa.me(_req("GET", "/api/auth/me", token=auth.create_token("lim-me-default")))
    assert res.status_code == 200
    assert json.loads(res.get_body())["maxImagesPerNote"] == 10


def test_me_reports_a_hand_edited_limit():
    _add_user("lim-me-custom", max_images_per_note=25)
    res = fa.me(_req("GET", "/api/auth/me", token=auth.create_token("lim-me-custom")))
    assert json.loads(res.get_body())["maxImagesPerNote"] == 25


def test_saving_preferences_does_not_clobber_the_limit():
    _add_user("lim-prefs", max_images_per_note=25)
    token = auth.create_token("lim-prefs")
    res = fa.update_preferences(
        _req("PUT", "/api/auth/preferences", {"sortBy": "modified"}, token)
    )
    assert res.status_code == 200
    assert fa.users_repo.get_user("lim-prefs").max_images_per_note == 25
