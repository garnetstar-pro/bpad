"""Image lifecycle orchestration over the images repository + blob store.

Kept out of function_app so the logic is unit-testable with in-memory fakes:
every function takes the repository and blob store as arguments.
"""
import uuid
from typing import Optional

from models import ImageRecord


def _delete_record_and_blob(images_repo, blob_store, user: str, image_id: str) -> None:
    """Delete an image's metadata record and, if it existed, its blob."""
    blob_path = images_repo.delete_image(user, image_id)
    if blob_path:
        blob_store.delete(blob_path)


def issue_upload(images_repo, blob_store, user: str, content_type: str, size_bytes: int) -> dict:
    image_id = str(uuid.uuid4())
    blob_path = f"{user}/{image_id}"
    images_repo.create_image(ImageRecord(
        id=image_id, user_id=user, note_id=None,
        blob_path=blob_path, content_type=content_type, size_bytes=size_bytes,
    ))
    return {"image_id": image_id, "upload_url": blob_store.upload_url(blob_path, content_type)}


def issue_read_url(images_repo, blob_store, user: str, image_id: str) -> Optional[str]:
    rec = images_repo.get_image(user, image_id)
    if rec is None:
        return None
    return blob_store.read_url(rec.blob_path)


def reconcile_note(images_repo, blob_store, user: str, note_id: str, image_ids) -> None:
    """Bind referenced images to the note; delete ones previously bound but now gone."""
    referenced = set(image_ids)
    for iid in referenced:
        if images_repo.get_image(user, iid) is not None:
            images_repo.set_note_id(user, iid, note_id)
    for rec in images_repo.images_for_note(user, note_id):
        if rec.id not in referenced:
            _delete_record_and_blob(images_repo, blob_store, user, rec.id)


def cascade_delete_note(images_repo, blob_store, user: str, note_id: str) -> None:
    for rec in images_repo.images_for_note(user, note_id):
        _delete_record_and_blob(images_repo, blob_store, user, rec.id)


def sweep_pending(images_repo, blob_store, user: str, cutoff) -> None:
    for rec in images_repo.pending_older_than(user, cutoff):
        _delete_record_and_blob(images_repo, blob_store, user, rec.id)
