from datetime import datetime

import images_ops
from models import ImageRecord
from repository import InMemoryImagesRepository
from blobstore import InMemoryBlobStore


def _setup():
    return InMemoryImagesRepository(), InMemoryBlobStore()


def test_issue_upload_registers_a_pending_record_and_returns_urls():
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    rec = repo.get_image("alice", out["image_id"])
    assert rec is not None and rec.note_id is None
    assert rec.blob_path == f"alice/{out['image_id']}"
    assert "upload" in out["upload_url"]


def test_issue_read_url_only_for_owner():
    repo, blob = _setup()
    out = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)
    assert images_ops.issue_read_url(repo, blob, "alice", out["image_id"]) is not None
    assert images_ops.issue_read_url(repo, blob, "bob", out["image_id"]) is None


def test_reconcile_binds_referenced_images_to_the_note():
    repo, blob = _setup()
    a = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [a])
    assert repo.get_image("alice", a).note_id == "note-1"


def test_reconcile_deletes_images_removed_from_the_note():
    repo, blob = _setup()
    a = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    b = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [a, b])
    # Second save drops b from the note's markdown.
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [a])
    assert repo.get_image("alice", a).note_id == "note-1"
    assert repo.get_image("alice", b) is None
    assert blob.deleted == [f"alice/{b}"]


def test_cascade_delete_removes_all_images_of_a_note():
    repo, blob = _setup()
    a = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    b = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [a, b])
    images_ops.cascade_delete_note(repo, blob, "alice", "note-1")
    assert repo.get_image("alice", a) is None
    assert repo.get_image("alice", b) is None
    assert set(blob.deleted) == {f"alice/{a}", f"alice/{b}"}


def test_sweep_pending_removes_only_old_unbound_images():
    repo, blob = _setup()
    old = ImageRecord(user_id="alice", blob_path="alice/old", content_type="image/webp",
                      size_bytes=1, created_at=datetime(2020, 1, 1))
    repo.create_image(old)
    fresh = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    images_ops.sweep_pending(repo, blob, "alice", datetime(2025, 1, 1))
    assert repo.get_image("alice", old.id) is None
    assert repo.get_image("alice", fresh) is not None
    assert blob.deleted == ["alice/old"]


def test_reconcile_skips_unowned_or_missing_referenced_ids():
    repo, blob = _setup()
    mine = images_ops.issue_upload(repo, blob, "alice", "image/webp", 100)["image_id"]
    bobs = images_ops.issue_upload(repo, blob, "bob", "image/webp", 100)["image_id"]
    # "ghost" doesn't exist; bobs isn't alice's — both must be ignored without error.
    images_ops.reconcile_note(repo, blob, "alice", "note-1", [mine, "ghost", bobs])
    assert repo.get_image("alice", mine).note_id == "note-1"
    assert repo.get_image("bob", bobs).note_id is None  # untouched
    assert blob.deleted == []
