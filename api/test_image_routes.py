import json

import azure.functions as func

import auth
import function_app as fa


def _req(method, url, body=None, token=None, route_params=None):
    headers = {"X-Auth-Token": token} if token else {}
    return func.HttpRequest(
        method=method, url=url, headers=headers, route_params=route_params or {},
        body=json.dumps(body).encode() if body is not None else None,
    )


def test_create_image_returns_upload_url_and_registers_pending():
    token = auth.create_token("img-alice")
    res = fa.create_image(_req("POST", "/api/images",
                               {"content_type": "image/webp", "size_bytes": 100}, token))
    assert res.status_code == 201
    out = json.loads(res.get_body())
    assert out["upload_url"] and out["image_id"]
    assert fa.images_repo.get_image("img-alice", out["image_id"]) is not None


def test_image_url_requires_ownership():
    token = auth.create_token("img-owner")
    created = json.loads(fa.create_image(_req("POST", "/api/images",
        {"content_type": "image/webp", "size_bytes": 100}, token)).get_body())
    iid = created["image_id"]

    ok = fa.image_url(_req("GET", f"/api/images/{iid}/url",
                           token=token, route_params={"id": iid}))
    assert ok.status_code == 200

    other = auth.create_token("img-intruder")
    denied = fa.image_url(_req("GET", f"/api/images/{iid}/url",
                               token=other, route_params={"id": iid}))
    assert denied.status_code == 404


def test_deleting_a_note_cascades_to_its_images():
    token = auth.create_token("img-del")
    iid = json.loads(fa.create_image(_req("POST", "/api/images",
        {"content_type": "image/webp", "size_bytes": 100}, token)).get_body())["image_id"]

    created = json.loads(fa.create_note(_req("POST", "/api/notes",
        {"iv": "x" * 16, "ct": "c" * 10, "image_ids": [iid]}, token)).get_body())
    note_id = created["id"]
    assert fa.images_repo.get_image("img-del", iid).note_id == note_id

    fa.blob_store.deleted.clear()
    res = fa.delete_note(_req("DELETE", f"/api/notes/{note_id}",
                              token=token, route_params={"id": note_id}))
    assert res.status_code == 204
    assert fa.images_repo.get_image("img-del", iid) is None
    assert fa.blob_store.deleted == [f"img-del/{iid}"]
