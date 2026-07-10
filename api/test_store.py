from models import Note
from store import find_note


def _note(**kw):
    defaults = dict(title="t", content="c")
    defaults.update(kw)
    return Note(**defaults)


def test_find_note_returns_matching_note():
    a = _note(content="first")
    b = _note(content="second")
    store = [a, b]
    assert find_note(store, b.id) is b


def test_find_note_returns_none_when_absent():
    store = [_note(), _note()]
    assert find_note(store, "does-not-exist") is None


def test_find_note_on_empty_store():
    assert find_note([], "anything") is None
