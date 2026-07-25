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
