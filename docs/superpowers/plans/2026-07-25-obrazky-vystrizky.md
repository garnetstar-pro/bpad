# Inline Images / Clippings in Notes — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste images/clippings into a note; the image renders inline in the markdown while its bytes live in Azure Blob Storage.

**Architecture:** The markdown carries a stable `![](bpad-img:ID)` reference, never a SAS URL. Blobs are unencrypted (Phase 1) in a private container; the API mints short-lived SAS URLs for direct client↔blob upload/read. A new Cosmos `images` container tracks `{id, user_id, note_id, blob_path, …}` so the server can clean up blobs it cannot read (the note content is encrypted). The client reports referenced image IDs on note save/update; note delete cascades.

**Tech Stack:** Python 3.12 Azure Functions + Pydantic + Cosmos + `azure-storage-blob`; React/Vite/TypeScript frontend, react-markdown, Web Crypto (unchanged), `<canvas>` for downscaling. Tests: pytest (api), vitest in plain Node with no jsdom (frontend).

## Global Constraints

- Zero-knowledge is preserved for note *text*; images are **plaintext blobs in Phase 1** (conscious simplification). Design keeps `bpad-img:ID` scheme + API stable so Phase 2 encryption is a content-only change.
- User-facing copy is **English via `t()`** (`frontend/src/i18n/en.ts`) — never hardcode strings in components.
- Code comments and logs are **English**.
- Repositories follow the existing pattern: `Protocol` + `InMemory*` + `Cosmos*` + `get_*_repository()` factory. Unset connection string → in-memory/no-op (tests, local).
- Session token is sent in the **`X-Auth-Token`** header (SWA drops `Authorization`).
- Frontend base URL switches on `import.meta.env.DEV`: `http://localhost:7071/api/...` vs relative `/api/...`.
- Frontend tests run in **plain Node (no jsdom)** — stub any `document`/`canvas`/`fetch`/`localStorage` globals in the test file itself.
- Image processing: downscale longest edge to **1600 px** (never upscale), re-encode **WebP q≈0.85**, reject input over **10 MiB**.
- New env vars: `BLOB_CONNECTION_STRING`, `IMAGES_CONTAINER` (default `note-images`).

---

### Task 1: Image models

**Files:**
- Modify: `api/models.py`
- Test: `api/test_images.py` (create)

**Interfaces:**
- Produces:
  - `ImageRecord(id: str, user_id: str, note_id: Optional[str], blob_path: str, content_type: str, size_bytes: int, created_at: datetime)`
  - `ImageCreateRequest(content_type: str, size_bytes: int)`
  - `NoteCreate.image_ids: list[str]` (new optional field, default `[]`)

- [ ] **Step 1: Write the failing test**

Create `api/test_images.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest test_images.py -v`
Expected: FAIL — `ImportError: cannot import name 'ImageRecord'`

- [ ] **Step 3: Write minimal implementation**

In `api/models.py`, add after the `Note` class (uses `Optional`, `datetime`, `uuid`, `Field` already imported at top):

```python
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
```

In `api/models.py`, add this field to `NoteCreate` (after `created_at`):

```python
    # IDs of images (bpad-img:ID) the note's markdown references. The server can't
    # read the encrypted content, so the client reports them for lifecycle/cleanup.
    image_ids: list[str] = Field(default_factory=list, max_length=100)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest test_images.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add api/models.py api/test_images.py
git commit -m "feat(api): image models + note image_ids field"
```

---

### Task 2: Images repository

**Files:**
- Modify: `api/repository.py`
- Test: `api/test_repository.py:end` (append)

**Interfaces:**
- Consumes: `ImageRecord` (Task 1)
- Produces `ImagesRepository` Protocol + `InMemoryImagesRepository` + `CosmosImagesRepository` + `get_images_repository()`:
  - `create_image(image: ImageRecord) -> None`
  - `get_image(user_id: str, image_id: str) -> Optional[ImageRecord]`
  - `set_note_id(user_id: str, image_id: str, note_id: str) -> None`
  - `images_for_note(user_id: str, note_id: str) -> list[ImageRecord]`
  - `delete_image(user_id: str, image_id: str) -> Optional[str]` (returns blob_path, or None if absent)
  - `pending_older_than(user_id: str, cutoff: datetime) -> list[ImageRecord]`

- [ ] **Step 1: Write the failing test**

Append to `api/test_repository.py`:

```python
from datetime import datetime, timedelta
from models import ImageRecord
from repository import InMemoryImagesRepository


def _img(user_id="alice", note_id=None, **kw):
    defaults = dict(user_id=user_id, note_id=note_id, blob_path=f"{user_id}/x",
                    content_type="image/webp", size_bytes=10)
    defaults.update(kw)
    return ImageRecord(**defaults)


def test_create_then_get_image_for_owner():
    repo = InMemoryImagesRepository()
    rec = _img()
    repo.create_image(rec)
    assert repo.get_image("alice", rec.id) is rec


def test_get_image_isolated_between_users():
    repo = InMemoryImagesRepository()
    rec = _img(user_id="alice")
    repo.create_image(rec)
    assert repo.get_image("bob", rec.id) is None


def test_set_note_id_binds_image_to_note():
    repo = InMemoryImagesRepository()
    rec = _img()
    repo.create_image(rec)
    repo.set_note_id("alice", rec.id, "note-1")
    assert repo.get_image("alice", rec.id).note_id == "note-1"


def test_images_for_note_returns_only_that_notes_images():
    repo = InMemoryImagesRepository()
    a = _img(note_id="note-1"); b = _img(note_id="note-1"); c = _img(note_id="note-2")
    for r in (a, b, c):
        repo.create_image(r)
    assert {r.id for r in repo.images_for_note("alice", "note-1")} == {a.id, b.id}


def test_delete_image_returns_blob_path_then_gone():
    repo = InMemoryImagesRepository()
    rec = _img(blob_path="alice/pic")
    repo.create_image(rec)
    assert repo.delete_image("alice", rec.id) == "alice/pic"
    assert repo.get_image("alice", rec.id) is None
    assert repo.delete_image("alice", rec.id) is None


def test_pending_older_than_only_lists_old_unbound_images():
    repo = InMemoryImagesRepository()
    old = _img(created_at=datetime(2020, 1, 1))
    fresh = _img(created_at=datetime(2999, 1, 1))
    bound = _img(note_id="note-1", created_at=datetime(2020, 1, 1))
    for r in (old, fresh, bound):
        repo.create_image(r)
    cutoff = datetime(2025, 1, 1)
    assert {r.id for r in repo.pending_older_than("alice", cutoff)} == {old.id}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest test_repository.py -k image -v`
Expected: FAIL — `ImportError: cannot import name 'InMemoryImagesRepository'`

- [ ] **Step 3: Write minimal implementation**

In `api/repository.py`, add `ImageRecord` to the models import at the top:

```python
from models import Note, User, Feedback, ImageRecord
```

Add a new section before the `# ---- factory` block:

```python
# ---------------------------------------------------------------- images

class ImagesRepository(Protocol):
    def create_image(self, image: ImageRecord) -> None: ...
    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]: ...
    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None: ...
    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]: ...
    def delete_image(self, user_id: str, image_id: str) -> Optional[str]: ...
    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]: ...


class InMemoryImagesRepository:
    """Temporary in-process image-metadata store (does not survive a restart)."""

    def __init__(self) -> None:
        self._images: dict[str, ImageRecord] = {}

    def create_image(self, image: ImageRecord) -> None:
        self._images[image.id] = image

    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]:
        img = self._images.get(image_id)
        return img if img and img.user_id == user_id else None

    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None:
        img = self.get_image(user_id, image_id)
        if img is not None:
            img.note_id = note_id

    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]:
        return [i for i in self._images.values() if i.user_id == user_id and i.note_id == note_id]

    def delete_image(self, user_id: str, image_id: str) -> Optional[str]:
        img = self.get_image(user_id, image_id)
        if img is None:
            return None
        del self._images[image_id]
        return img.blob_path

    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]:
        return [
            i for i in self._images.values()
            if i.user_id == user_id and i.note_id is None and i.created_at < cutoff
        ]


class CosmosImagesRepository:
    """Persistent image-metadata store in Azure Cosmos DB (partition /user_id)."""

    def __init__(self, connection_string: str, database: str = "bpad", container: str = "images") -> None:
        self._cs = connection_string
        self._database_name = database
        self._container_name = container
        self._container = None

    def _c(self):
        if self._container is None:
            from azure.cosmos import CosmosClient, PartitionKey

            client = CosmosClient.from_connection_string(self._cs)
            db = client.create_database_if_not_exists(self._database_name)
            self._container = db.create_container_if_not_exists(
                id=self._container_name, partition_key=PartitionKey(path="/user_id")
            )
        return self._container

    def create_image(self, image: ImageRecord) -> None:
        self._c().create_item(image.model_dump(mode="json"))

    def get_image(self, user_id: str, image_id: str) -> Optional[ImageRecord]:
        from azure.cosmos import exceptions

        try:
            item = self._c().read_item(item=image_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return ImageRecord.model_validate(item)

    def set_note_id(self, user_id: str, image_id: str, note_id: str) -> None:
        rec = self.get_image(user_id, image_id)
        if rec is None:
            return
        rec.note_id = note_id
        self._c().upsert_item(rec.model_dump(mode="json"))

    def images_for_note(self, user_id: str, note_id: str) -> list[ImageRecord]:
        items = self._c().query_items(
            query="SELECT * FROM c WHERE c.user_id = @u AND c.note_id = @n",
            parameters=[{"name": "@u", "value": user_id}, {"name": "@n", "value": note_id}],
            partition_key=user_id,
        )
        return [ImageRecord.model_validate(i) for i in items]

    def delete_image(self, user_id: str, image_id: str) -> Optional[str]:
        from azure.cosmos import exceptions

        rec = self.get_image(user_id, image_id)
        if rec is None:
            return None
        try:
            self._c().delete_item(item=image_id, partition_key=user_id)
        except exceptions.CosmosResourceNotFoundError:
            return None
        return rec.blob_path

    def pending_older_than(self, user_id: str, cutoff) -> list[ImageRecord]:
        items = self._c().query_items(
            query="SELECT * FROM c WHERE c.user_id = @u AND (NOT IS_DEFINED(c.note_id) OR c.note_id = null) AND c.created_at < @cut",
            parameters=[{"name": "@u", "value": user_id}, {"name": "@cut", "value": cutoff.isoformat()}],
            partition_key=user_id,
        )
        return [ImageRecord.model_validate(i) for i in items]
```

Add the factory next to `get_notes_repository` (near the other factories):

```python
def get_images_repository() -> ImagesRepository:
    cs = _connection_string()
    if cs:
        return CosmosImagesRepository(cs, database=_database_name())
    logging.warning(
        "COSMOS_CONNECTION_STRING is not set - image metadata is stored in a "
        "temporary in-memory store (it will not survive a restart)."
    )
    return InMemoryImagesRepository()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest test_repository.py -k image -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add api/repository.py api/test_repository.py
git commit -m "feat(api): images repository (metadata store)"
```

---

### Task 3: Blob store adapter

**Files:**
- Create: `api/blobstore.py`
- Modify: `api/requirements.txt`, `api/requirements-dev.txt`
- Test: `api/test_blobstore.py` (create)

**Interfaces:**
- Produces `BlobStore` Protocol + `InMemoryBlobStore` + `AzureBlobStore` + `get_blob_store()`:
  - `upload_url(blob_path: str, content_type: str) -> str`
  - `read_url(blob_path: str) -> str`
  - `delete(blob_path: str) -> None`
  - `InMemoryBlobStore.deleted: list[str]` (public, for assertions)

- [ ] **Step 1: Write the failing test**

Create `api/test_blobstore.py`:

```python
from blobstore import InMemoryBlobStore, get_blob_store


def test_upload_url_is_a_distinct_upload_reference():
    store = InMemoryBlobStore()
    url = store.upload_url("alice/pic", "image/webp")
    assert "alice/pic" in url and "upload" in url


def test_read_url_is_a_distinct_read_reference():
    store = InMemoryBlobStore()
    url = store.read_url("alice/pic")
    assert "alice/pic" in url and "read" in url


def test_delete_is_recorded():
    store = InMemoryBlobStore()
    store.delete("alice/pic")
    assert store.deleted == ["alice/pic"]


def test_factory_without_connection_string_returns_in_memory(monkeypatch):
    monkeypatch.delenv("BLOB_CONNECTION_STRING", raising=False)
    assert isinstance(get_blob_store(), InMemoryBlobStore)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest test_blobstore.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'blobstore'`

- [ ] **Step 3: Write minimal implementation**

Create `api/blobstore.py`:

```python
import logging
import os
from datetime import datetime, timedelta
from typing import Protocol

_UPLOAD_TTL = timedelta(minutes=15)
_READ_TTL = timedelta(minutes=15)


class BlobStore(Protocol):
    def upload_url(self, blob_path: str, content_type: str) -> str: ...
    def read_url(self, blob_path: str) -> str: ...
    def delete(self, blob_path: str) -> None: ...


class InMemoryBlobStore:
    """No-op blob store (fallback when BLOB_CONNECTION_STRING is unset; used by tests)."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    def upload_url(self, blob_path: str, content_type: str) -> str:
        return f"memory://{blob_path}?mode=upload"

    def read_url(self, blob_path: str) -> str:
        return f"memory://{blob_path}?mode=read"

    def delete(self, blob_path: str) -> None:
        self.deleted.append(blob_path)


class AzureBlobStore:
    """Private-container blob store issuing short-lived SAS URLs (Azure Blob Storage)."""

    def __init__(self, connection_string: str, container: str = "note-images") -> None:
        self._cs = connection_string
        self._container_name = container
        self._service = None

    def _svc(self):
        if self._service is None:
            from azure.storage.blob import BlobServiceClient

            self._service = BlobServiceClient.from_connection_string(self._cs)
            try:
                self._service.create_container(self._container_name)  # private by default
            except Exception:
                pass  # already exists
        return self._service

    def _sas(self, blob_path: str, permission, ttl: timedelta) -> str:
        from azure.storage.blob import generate_blob_sas

        svc = self._svc()
        token = generate_blob_sas(
            account_name=svc.account_name,
            container_name=self._container_name,
            blob_name=blob_path,
            account_key=svc.credential.account_key,
            permission=permission,
            expiry=datetime.utcnow() + ttl,
        )
        base = svc.url.rstrip("/")
        return f"{base}/{self._container_name}/{blob_path}?{token}"

    def upload_url(self, blob_path: str, content_type: str) -> str:
        from azure.storage.blob import BlobSasPermissions

        return self._sas(blob_path, BlobSasPermissions(create=True, write=True), _UPLOAD_TTL)

    def read_url(self, blob_path: str) -> str:
        from azure.storage.blob import BlobSasPermissions

        return self._sas(blob_path, BlobSasPermissions(read=True), _READ_TTL)

    def delete(self, blob_path: str) -> None:
        client = self._svc().get_blob_client(self._container_name, blob_path)
        try:
            client.delete_blob()
        except Exception:
            pass  # best-effort: a missing blob is already the desired state


def get_blob_store() -> BlobStore:
    cs = os.environ.get("BLOB_CONNECTION_STRING")
    if cs:
        return AzureBlobStore(cs, container=os.environ.get("IMAGES_CONTAINER", "note-images"))
    logging.warning(
        "BLOB_CONNECTION_STRING is not set - image blobs use an in-memory no-op store."
    )
    return InMemoryBlobStore()
```

Add `azure-storage-blob` to `api/requirements.txt` (append a line):

```
azure-storage-blob
```

Add the same line to `api/requirements-dev.txt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest test_blobstore.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add api/blobstore.py api/test_blobstore.py api/requirements.txt api/requirements-dev.txt
git commit -m "feat(api): blob store adapter with SAS URLs"
```

---

### Task 4: Image lifecycle operations

**Files:**
- Create: `api/images_ops.py`
- Test: `api/test_images_ops.py` (create)

**Interfaces:**
- Consumes: `ImagesRepository` (Task 2), `BlobStore` (Task 3), `ImageRecord` (Task 1)
- Produces (all take repo + blob store as parameters so they're testable without Azure):
  - `issue_upload(images_repo, blob_store, user, content_type, size_bytes) -> dict` → `{"image_id", "upload_url"}`
  - `issue_read_url(images_repo, blob_store, user, image_id) -> Optional[str]`
  - `reconcile_note(images_repo, blob_store, user, note_id, image_ids) -> None`
  - `cascade_delete_note(images_repo, blob_store, user, note_id) -> None`
  - `sweep_pending(images_repo, blob_store, user, cutoff) -> None`

- [ ] **Step 1: Write the failing test**

Create `api/test_images_ops.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest test_images_ops.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'images_ops'`

- [ ] **Step 3: Write minimal implementation**

Create `api/images_ops.py`:

```python
"""Image lifecycle orchestration over the images repository + blob store.

Kept out of function_app so the logic is unit-testable with in-memory fakes:
every function takes the repository and blob store as arguments.
"""
import uuid

from models import ImageRecord


def issue_upload(images_repo, blob_store, user: str, content_type: str, size_bytes: int) -> dict:
    image_id = str(uuid.uuid4())
    blob_path = f"{user}/{image_id}"
    images_repo.create_image(ImageRecord(
        id=image_id, user_id=user, note_id=None,
        blob_path=blob_path, content_type=content_type, size_bytes=size_bytes,
    ))
    return {"image_id": image_id, "upload_url": blob_store.upload_url(blob_path, content_type)}


def issue_read_url(images_repo, blob_store, user: str, image_id: str):
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
            blob_path = images_repo.delete_image(user, rec.id)
            if blob_path:
                blob_store.delete(blob_path)


def cascade_delete_note(images_repo, blob_store, user: str, note_id: str) -> None:
    for rec in images_repo.images_for_note(user, note_id):
        blob_path = images_repo.delete_image(user, rec.id)
        if blob_path:
            blob_store.delete(blob_path)


def sweep_pending(images_repo, blob_store, user: str, cutoff) -> None:
    for rec in images_repo.pending_older_than(user, cutoff):
        blob_path = images_repo.delete_image(user, rec.id)
        if blob_path:
            blob_store.delete(blob_path)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest test_images_ops.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add api/images_ops.py api/test_images_ops.py
git commit -m "feat(api): image lifecycle operations (reconcile/cascade/sweep)"
```

---

### Task 5: Wire the API routes + note lifecycle hooks

**Files:**
- Modify: `api/function_app.py`
- Test: `api/test_image_routes.py` (create)

**Interfaces:**
- Consumes: `images_ops` (Task 4), `get_images_repository` (Task 2), `get_blob_store` (Task 3), `ImageCreateRequest` (Task 1)
- Produces routes: `POST /api/images`, `GET /api/images/{id}/url`; extends `create_note`/`update_note`/`delete_note`.

- [ ] **Step 1: Write the failing test**

Create `api/test_image_routes.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest test_image_routes.py -v`
Expected: FAIL — `AttributeError: module 'function_app' has no attribute 'create_image'`

- [ ] **Step 3: Write minimal implementation**

In `api/function_app.py`, extend the models import:

```python
from models import (
    Note, NoteCreate, User,
    RegisterRequest, LoginRequest, RecoverRequest, ChangePasswordRequest,
    VerifyEmailRequest, PreferencesRequest,
    Feedback, FeedbackRequest,
    ImageCreateRequest,
)
```

Extend the repository import and add the new module import:

```python
from repository import (
    get_notes_repository, get_users_repository, get_feedback_repository,
    get_images_repository,
)
from blobstore import get_blob_store
import images_ops
```

Add module-level instances next to the other repos (after `feedback_repo = ...`):

```python
images_repo = get_images_repository()
blob_store = get_blob_store()
```

Add a TTL constant next to `_VERIFY_TTL`:

```python
_PENDING_IMAGE_TTL = timedelta(hours=24)  # lazy GC horizon for unclaimed image uploads
```

In `create_note`, after `notes_repo.save_note(note)` and before the `return`:

```python
    images_ops.reconcile_note(images_repo, blob_store, user, note.id, data.image_ids)
```

In `update_note`, after `notes_repo.save_note(note)` and before the `return`:

```python
    images_ops.reconcile_note(images_repo, blob_store, user, note.id, data.image_ids)
```

Replace the body of `delete_note` so it cascades (capture the id first):

```python
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
```

Add the two image routes after the notes section (before `# ---- feedback`):

```python
# ---------------------------------------------------------------- images

@app.route(route="images", methods=["POST"])
def create_image(req: func.HttpRequest) -> func.HttpResponse:
    user = _require_user(req)
    if isinstance(user, func.HttpResponse):
        return user
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest test_image_routes.py -v && .venv/bin/python -m pytest`
Expected: PASS (3 passed in the new file; whole suite green)

- [ ] **Step 5: Commit**

```bash
git add api/function_app.py api/test_image_routes.py
git commit -m "feat(api): image upload/read routes + note lifecycle hooks"
```

---

### Task 6: Frontend pure helpers

**Files:**
- Create: `frontend/src/images.ts`
- Test: `frontend/src/images.test.ts` (create)

**Interfaces:**
- Produces:
  - `parseImageIds(markdown: string): string[]`
  - `fitDimensions(w: number, h: number, max: number): { w: number; h: number }`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/images.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseImageIds, fitDimensions } from './images'

describe('parseImageIds', () => {
  it('finds every bpad-img reference and dedups', () => {
    const md = 'a ![](bpad-img:aaa) b ![alt](bpad-img:bbb) c ![](bpad-img:aaa)'
    expect(parseImageIds(md).sort()).toEqual(['aaa', 'bbb'])
  })

  it('ignores normal images and links', () => {
    const md = '![pic](https://x/y.png) [link](bpad-img:not-an-image)'
    expect(parseImageIds(md)).toEqual([])
  })

  it('returns empty for content without images', () => {
    expect(parseImageIds('just text')).toEqual([])
  })
})

describe('fitDimensions', () => {
  it('never upscales a small image', () => {
    expect(fitDimensions(800, 600, 1600)).toEqual({ w: 800, h: 600 })
  })

  it('scales the longest edge down to max, keeping aspect', () => {
    expect(fitDimensions(3200, 1600, 1600)).toEqual({ w: 1600, h: 800 })
  })

  it('handles a tall image', () => {
    expect(fitDimensions(1000, 4000, 1600)).toEqual({ w: 400, h: 1600 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- images.test.ts`
Expected: FAIL — cannot resolve `./images`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/images.ts`:

```ts
// Image clippings: parse references out of note markdown, size math, upload,
// and read-URL resolution. Phase 1 stores blobs unencrypted (see the design doc);
// the bpad-img:ID scheme is kept stable so encryption is a later, content-only change.

// Matches an image (not a link): ![alt](bpad-img:ID). IDs are uuid-shaped.
const IMG_RE = /!\[[^\]]*\]\(bpad-img:([A-Za-z0-9-]+)\)/g

export function parseImageIds(markdown: string): string[] {
  const ids = new Set<string>()
  for (const m of markdown.matchAll(IMG_RE)) ids.add(m[1])
  return [...ids]
}

// Fit (w,h) within a max longest-edge, never upscaling.
export function fitDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const scale = max / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- images.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/images.ts frontend/src/images.test.ts
git commit -m "feat(web): image markdown parsing + downscale math"
```

---

### Task 7: Frontend image client (process, upload, resolve)

**Files:**
- Modify: `frontend/src/images.ts`
- Test: `frontend/src/images.test.ts` (append)

**Interfaces:**
- Consumes: `fitDimensions` (Task 6), `getToken` (`session.ts`)
- Produces:
  - `MAX_EDGE = 1600`, `MAX_INPUT_BYTES = 10 * 1024 * 1024`
  - `processImage(file: Blob): Promise<Blob>` (throws `Error('too-large')` over the cap)
  - `uploadImage(blob: Blob): Promise<string>` (returns image_id)
  - `resolveImageUrl(id: string): Promise<string>` (in-memory cached until near SAS expiry)

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/images.test.ts` (add `beforeEach`, `afterEach`, `vi` to the vitest import at the top of the file):

```ts
import { uploadImage, resolveImageUrl, processImage, MAX_INPUT_BYTES } from './images'
import { setSession, clearSession } from './session'

// session.ts reads no DOM; only a data key + token are needed.
function withSession() {
  setSession('tok', new Uint8Array(32), new Uint8Array(32), 'alice')
}

describe('uploadImage', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('inits the upload then PUTs the blob and returns the id', async () => {
    withSession()
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (String(url).endsWith('/api/images')) {
        return { ok: true, json: async () => ({ image_id: 'img1', upload_url: 'https://blob/put' }) } as Response
      }
      return { ok: true } as Response // the PUT to blob storage
    })
    vi.stubGlobal('fetch', fetchMock)

    const id = await uploadImage(new Blob(['x'], { type: 'image/webp' }))

    expect(id).toBe('img1')
    expect(calls[0]).toContain('POST http://localhost:7071/api/images')
    expect(calls[1]).toBe('PUT https://blob/put')
  })
})

describe('resolveImageUrl', () => {
  afterEach(() => { clearSession(); vi.restoreAllMocks() })

  it('fetches a read url once and caches it', async () => {
    withSession()
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://blob/read?sas' }) }) as Response)
    vi.stubGlobal('fetch', fetchMock)

    const a = await resolveImageUrl('imgX')
    const b = await resolveImageUrl('imgX')

    expect(a).toBe('https://blob/read?sas')
    expect(b).toBe('https://blob/read?sas')
    expect(fetchMock).toHaveBeenCalledTimes(1) // second call served from cache
  })
})

describe('processImage', () => {
  it('rejects input over the hard cap without touching a canvas', async () => {
    const big = { size: MAX_INPUT_BYTES + 1, type: 'image/png' } as Blob
    await expect(processImage(big)).rejects.toThrow('too-large')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test -- images.test.ts`
Expected: FAIL — `uploadImage` / `resolveImageUrl` / `processImage` not exported

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/images.ts` (add the import at the top of the file):

```ts
import { getToken } from './session'

const API_URL = import.meta.env.DEV ? 'http://localhost:7071/api/images' : '/api/images'
export const MAX_EDGE = 1600
export const MAX_INPUT_BYTES = 10 * 1024 * 1024 // 10 MiB

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { 'X-Auth-Token': token } : {}
}

// Downscale + re-encode to WebP so blobs (and the offline cache) stay small.
export async function processImage(file: Blob): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('too-large')
  const bitmap = await createImageBitmap(file)
  const { w, h } = fitDimensions(bitmap.width, bitmap.height, MAX_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('encode-failed'))),
      'image/webp',
      0.85,
    ),
  )
}

// Upload a processed image; returns its stable bpad image id.
export async function uploadImage(blob: Blob): Promise<string> {
  const init = await fetch(API_URL, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: blob.type, size_bytes: blob.size }),
  })
  if (!init.ok) throw new Error('upload-init-failed')
  const { image_id, upload_url } = await init.json()
  const put = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': blob.type },
    body: blob,
  })
  if (!put.ok) throw new Error('upload-failed')
  return image_id
}

// Resolve a bpad image id to a short-lived readable URL, cached in memory.
// Refreshed before the server's 15-minute SAS lapses.
const urlCache = new Map<string, { url: string; expires: number }>()
const READ_TTL_MS = 10 * 60 * 1000

export async function resolveImageUrl(id: string): Promise<string> {
  const hit = urlCache.get(id)
  if (hit && hit.expires > Date.now()) return hit.url
  const res = await fetch(`${API_URL}/${id}/url`, { headers: authHeaders() })
  if (!res.ok) throw new Error('resolve-failed')
  const { url } = await res.json()
  urlCache.set(id, { url, expires: Date.now() + READ_TTL_MS })
  return url
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test -- images.test.ts`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/images.ts frontend/src/images.test.ts
git commit -m "feat(web): image process/upload/resolve client"
```

---

### Task 8: Render bpad images in markdown

**Files:**
- Modify: `frontend/src/markdown.tsx`
- Modify: `frontend/src/i18n/en.ts`

**Interfaces:**
- Consumes: `resolveImageUrl` (Task 7)
- Produces: `markdownComponents.img` renders `bpad-img:` sources via a `BpadImage` component; plain `http(s)` images render normally.

Note: this is a React component task without a unit test — the repo has no jsdom and does not test components. Verify visually in Task 10's manual check.

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/en.ts`, add an `images` section (place it after the `editor` block):

```ts
  images: {
    loading: 'loading image…',
    failed: 'image unavailable',
    alt: 'note image',
  },
```

- [ ] **Step 2: Implement the renderer**

Replace `frontend/src/markdown.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { Components } from 'react-markdown'
import { resolveImageUrl } from './images'
import { useTranslation } from './i18n'

const BPAD_IMG_PREFIX = 'bpad-img:'

// Resolves a bpad-img:ID source to a short-lived SAS URL and renders it.
function BpadImage({ id, alt }: { id: string; alt: string }) {
  const { t } = useTranslation()
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    resolveImageUrl(id)
      .then((url) => active && setSrc(url))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [id])

  if (failed) return <span className="note-image-failed">{t('images.failed')}</span>
  if (!src) return <span className="note-image-loading">{t('images.loading')}</span>
  return <img className="note-image" src={src} alt={alt || t('images.alt')} loading="lazy" />
}

// Open links in notes in a new tab (and safely: noopener/noreferrer). Render
// bpad-img: sources through BpadImage; leave normal images to the browser.
export const markdownComponents: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />
  },
  img({ node: _node, src, alt, ...props }) {
    if (typeof src === 'string' && src.startsWith(BPAD_IMG_PREFIX)) {
      return <BpadImage id={src.slice(BPAD_IMG_PREFIX.length)} alt={alt ?? ''} />
    }
    return <img src={src} alt={alt} {...props} />
  },
}
```

- [ ] **Step 3: Verify the build type-checks**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes, Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/markdown.tsx frontend/src/i18n/en.ts
git commit -m "feat(web): render bpad-img images inline in markdown"
```

---

### Task 9: Send image_ids on note create/update

**Files:**
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: `parseImageIds` (Task 6)
- Produces: `createNote`/`updateNote` include `image_ids` (parsed from `content`) in the request body.

Note: `api.test.ts` stubs `fetch` implicitly by relying on the network-failure path; it does not assert request bodies, so no new test is required here. The claim behaviour is covered by the API tests (Task 5).

- [ ] **Step 1: Wire image_ids into the request bodies**

In `frontend/src/api.ts`, add the import near the other local imports:

```ts
import { parseImageIds } from './images'
```

In `createNote`, change the POST body to include `image_ids`:

```ts
      body: JSON.stringify({
        ...(await encryptPayload(content, opts.title, tags)),
        image_ids: parseImageIds(content),
        ...(opts.createdAt ? { created_at: opts.createdAt } : {}),
      }),
```

In `updateNote`, change the PUT body to include `image_ids`:

```ts
      body: JSON.stringify({
        ...(await encryptPayload(content, title, tags)),
        image_ids: parseImageIds(content),
      }),
```

- [ ] **Step 2: Verify existing tests + build stay green**

Run: `cd frontend && npm run test -- api.test.ts && npm run build`
Expected: existing api tests PASS; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat(web): report referenced image_ids on note save"
```

---

### Task 10: Paste-to-insert in the editor

**Files:**
- Modify: `frontend/src/Editor.tsx`
- Modify: `frontend/src/i18n/en.ts`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Consumes: `processImage`, `uploadImage` (Task 7)
- Produces: pasting an image into the write textarea uploads it and inserts `![](bpad-img:ID)` at the caret; upload disables submit and shows errors.

Note: component task, no unit test (no jsdom). Ends with a manual end-to-end verification.

- [ ] **Step 1: Add i18n strings**

In `frontend/src/i18n/en.ts`, add these keys inside the existing `editor` block:

```ts
    imageUploading: 'uploading image…',
    imageTooLarge: 'that image is too large (max 10 MB)',
    imageFailed: 'image upload failed, try again',
```

- [ ] **Step 2: Implement the paste handler**

In `frontend/src/Editor.tsx`, add the import near the top:

```ts
import { processImage, uploadImage } from './images'
```

Add an `uploading` state next to the other `useState` calls in the component:

```ts
  const [uploading, setUploading] = useState(false)
```

Add the paste handler above the `return` (uses `textareaRef`, `setDraft`, `setError`, `t`):

```ts
  // Paste an image (clipboard clipping) → upload → insert ![](bpad-img:ID) at the caret.
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
    if (!item) return // let normal text paste through
    e.preventDefault()
    const file = item.getAsFile()
    if (!file) return
    const ta = textareaRef.current
    const start = ta ? ta.selectionStart : draft.length
    const end = ta ? ta.selectionEnd : draft.length
    setUploading(true)
    setError(null)
    try {
      const processed = await processImage(file)
      const id = await uploadImage(processed)
      const snippet = `![](bpad-img:${id})`
      setDraft((d) => d.slice(0, start) + snippet + d.slice(end))
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      setError(code === 'too-large' ? t('editor.imageTooLarge') : t('editor.imageFailed'))
    } finally {
      setUploading(false)
    }
  }
```

Wire it onto the write textarea and reflect the uploading state — replace the `<textarea …>` element with:

```tsx
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={handlePaste}
          placeholder={t('editor.bodyPlaceholder')}
          disabled={submitting}
        />
```

Guard submit while an image is uploading — change the save button's `disabled`:

```tsx
          <button className="save-btn" onClick={submit} disabled={submitting || uploading} type="button">
```

Show the uploading hint — change the `capture-hint` span:

```tsx
        <span className="capture-hint">
          {uploading
            ? t('editor.imageUploading')
            : submitting
              ? t('editor.saving')
              : t('editor.saveHint', { label: submitLabel })}
        </span>
```

- [ ] **Step 3: Add minimal image styles**

Append to `frontend/src/App.css`:

```css
.note-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: block;
  margin: 0.5rem 0;
}
.note-image-loading,
.note-image-failed {
  display: inline-block;
  font-size: 0.85em;
  opacity: 0.6;
  font-style: italic;
}
```

- [ ] **Step 4: Type-check and build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes, build succeeds.

- [ ] **Step 5: Manual end-to-end verification**

In one terminal: `cd api && source .venv/bin/activate && POW_DIFFICULTY=0 func start` (in-memory repos + no-op blob store; the upload PUT goes to `memory://…`, so for a *real* blob round trip set `BLOB_CONNECTION_STRING` to a storage account first).

With a real `BLOB_CONNECTION_STRING` set, in another terminal: `cd frontend && npm run dev`. Then:
1. Register/log in, open a new entry.
2. Take a screenshot to the clipboard, focus the body, press Ctrl+V.
3. Confirm the hint shows "uploading image…", then `![](bpad-img:…)` appears at the caret.
4. Switch to Preview — the image renders. Save; open the note — it renders in the detail.
5. Delete the note; confirm no error (blob + record cascade-deleted).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/Editor.tsx frontend/src/i18n/en.ts frontend/src/App.css
git commit -m "feat(web): paste image clippings into the editor"
```

---

## Self-Review

**Spec coverage:**
- Paste as primary input → Task 10. ✅
- Inline at caret via `bpad-img:ID` → Tasks 6, 8, 10. ✅
- Unencrypted private blob + short SAS, direct client↔blob → Tasks 3, 7. ✅
- Client downscale 1600px/WebP 0.85/10 MiB cap → Tasks 6, 7. ✅
- `images` Cosmos container + record shape → Tasks 1, 2. ✅
- `POST /api/images`, `GET /api/images/{id}/url` → Task 5. ✅
- `image_ids` claim on create/update, cascade on delete → Tasks 1, 5, 9. ✅
- Lazy GC of pending > 24h → Tasks 4, 5. ✅
- Env vars `BLOB_CONNECTION_STRING`, `IMAGES_CONTAINER` → Task 3. ✅
- Out of scope (backup, offline, premium gating, encryption) → intentionally untouched. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `reconcile_note`/`cascade_delete_note`/`sweep_pending`/`issue_upload`/`issue_read_url` signatures match between Tasks 4 and 5. `parseImageIds`/`fitDimensions`/`processImage`/`uploadImage`/`resolveImageUrl` names match between Tasks 6, 7, 8, 9, 10. `ImageRecord` fields consistent across Tasks 1, 2, 4. ✅
