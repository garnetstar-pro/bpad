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
