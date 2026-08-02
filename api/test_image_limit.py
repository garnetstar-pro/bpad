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


# --- helpers ---

def test_image_limit_falls_back_to_the_default_without_a_user():
    assert fa._image_limit(None) == fa._DEFAULT_MAX_IMAGES_PER_NOTE == 10


def test_image_limit_reads_the_users_own_quota():
    assert fa._image_limit(_add_user("lim-helper", max_images_per_note=3)) == 3


def test_image_limit_exceeded_only_past_the_cap():
    assert fa._image_limit_exceeded([f"i{n}" for n in range(10)], 10) is False
    assert fa._image_limit_exceeded([f"i{n}" for n in range(11)], 10) is True


def test_image_limit_counts_distinct_ids():
    # The same picture used three times in one note is one image.
    assert fa._image_limit_exceeded(["a", "a", "a"], 1) is False


# --- routes ---

def _note_body(image_ids):
    return {"iv": "x" * 16, "ct": "c" * 10, "image_ids": image_ids}


def test_create_note_allows_exactly_the_limit():
    _add_user("lim-create-ok")
    token = auth.create_token("lim-create-ok")
    res = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(10)]), token))
    assert res.status_code == 201


def test_create_note_rejects_one_over_the_limit():
    _add_user("lim-create-no")
    token = auth.create_token("lim-create-no")
    res = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(11)]), token))
    assert res.status_code == 403
    assert "at most 10 images" in json.loads(res.get_body())["error"]
    # Nothing was written.
    assert fa.notes_repo.count_notes("lim-create-no") == 0


def test_create_note_honours_a_hand_edited_quota():
    _add_user("lim-create-25", max_images_per_note=25)
    token = auth.create_token("lim-create-25")
    ok = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(25)]), token))
    assert ok.status_code == 201
    over = fa.create_note(_req("POST", "/api/notes", _note_body([f"i{n}" for n in range(26)]), token))
    assert over.status_code == 403
    assert "at most 25 images" in json.loads(over.get_body())["error"]


def test_update_note_rejects_one_over_the_limit_and_keeps_the_note():
    _add_user("lim-update")
    token = auth.create_token("lim-update")
    created = json.loads(
        fa.create_note(_req("POST", "/api/notes", _note_body(["keep"]), token)).get_body()
    )
    note_id = created["id"]

    body = _note_body([f"i{n}" for n in range(11)])
    body["ct"] = "replacement"
    res = fa.update_note(
        _req("PUT", f"/api/notes/{note_id}", body, token, route_params={"id": note_id})
    )
    assert res.status_code == 403
    assert fa.notes_repo.get_note("lim-update", note_id).ct == "c" * 10


def test_update_note_allows_exactly_the_limit():
    _add_user("lim-update-ok")
    token = auth.create_token("lim-update-ok")
    created = json.loads(
        fa.create_note(_req("POST", "/api/notes", _note_body([]), token)).get_body()
    )
    note_id = created["id"]
    res = fa.update_note(
        _req("PUT", f"/api/notes/{note_id}", _note_body([f"i{n}" for n in range(10)]),
             token, route_params={"id": note_id})
    )
    assert res.status_code == 200
