import pytest
from pydantic import ValidationError

from models import ImageRecord, ImageCreateRequest, NoteCreate


def test_image_create_accepts_a_normal_request():
    req = ImageCreateRequest(content_type="image/webp", size_bytes=12345)
    assert req.content_type == "image/webp"
    assert req.size_bytes == 12345


def test_image_create_rejects_zero_bytes():
    with pytest.raises(ValidationError):
        ImageCreateRequest(content_type="image/webp", size_bytes=0)


def test_image_create_rejects_over_ten_mib():
    with pytest.raises(ValidationError):
        ImageCreateRequest(content_type="image/webp", size_bytes=10 * 1024 * 1024 + 1)


def test_image_record_defaults_to_pending_with_id_and_timestamp():
    rec = ImageRecord(user_id="alice", blob_path="alice/x", content_type="image/webp", size_bytes=10)
    assert rec.id
    assert rec.note_id is None
    assert rec.created_at is not None


def test_note_create_defaults_image_ids_to_empty():
    note = NoteCreate(iv="x" * 16, ct="c" * 10)
    assert note.image_ids == []


def test_note_create_accepts_image_ids():
    note = NoteCreate(iv="x" * 16, ct="c" * 10, image_ids=["a", "b"])
    assert note.image_ids == ["a", "b"]
