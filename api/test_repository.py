from models import Note
from repository import InMemoryNotesRepository


def _note(**kw):
    defaults = dict(title="t", content="c")
    defaults.update(kw)
    return Note(**defaults)


def test_save_then_get_returns_note():
    repo = InMemoryNotesRepository()
    n = _note(content="hello")
    repo.save_note(n)
    assert repo.get_note(n.id) is n


def test_get_missing_returns_none():
    repo = InMemoryNotesRepository()
    assert repo.get_note("nope") is None


def test_list_is_newest_first():
    repo = InMemoryNotesRepository()
    older = _note(created_at="2026-01-01T00:00:00")
    newer = _note(created_at="2026-06-01T00:00:00")
    repo.save_note(older)
    repo.save_note(newer)
    assert [n.id for n in repo.list_notes()] == [newer.id, older.id]


def test_save_same_id_updates_in_place():
    repo = InMemoryNotesRepository()
    n = _note(content="first")
    repo.save_note(n)
    n.content = "second"
    n.title = "updated"
    repo.save_note(n)
    assert len(repo.list_notes()) == 1
    assert repo.get_note(n.id).content == "second"


def test_delete_removes_and_reports_true():
    repo = InMemoryNotesRepository()
    n = _note()
    repo.save_note(n)
    assert repo.delete_note(n.id) is True
    assert repo.get_note(n.id) is None


def test_delete_missing_reports_false():
    repo = InMemoryNotesRepository()
    assert repo.delete_note("nope") is False
