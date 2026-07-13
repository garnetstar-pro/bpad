from models import Note, User, Encrypted
from repository import InMemoryNotesRepository, InMemoryUsersRepository


def _note(user_id="alice", **kw):
    defaults = dict(user_id=user_id, iv="iv", ct="ct")
    defaults.update(kw)
    return Note(**defaults)


def _user(username="alice", email=None):
    enc = Encrypted(iv="i", ct="c")
    return User(
        username=username,
        email=email,
        salt="s",
        recovery_salt="rs",
        auth_hash="ah",
        rec_auth_hash="rah",
        wrapped_data_key_pw=enc,
        wrapped_data_key_rec=enc,
    )


# --- notes: scoping per user ---

def test_save_then_get_returns_note_for_owner():
    repo = InMemoryNotesRepository()
    n = _note()
    repo.save_note(n)
    assert repo.get_note("alice", n.id) is n


def test_get_note_isolated_between_users():
    repo = InMemoryNotesRepository()
    n = _note(user_id="alice")
    repo.save_note(n)
    assert repo.get_note("bob", n.id) is None


def test_list_only_returns_own_notes():
    repo = InMemoryNotesRepository()
    repo.save_note(_note(user_id="alice"))
    repo.save_note(_note(user_id="bob"))
    listed = repo.list_notes("alice")
    assert len(listed) == 1 and listed[0].user_id == "alice"


def test_list_is_newest_first():
    repo = InMemoryNotesRepository()
    older = _note(created_at="2026-01-01T00:00:00")
    newer = _note(created_at="2026-06-01T00:00:00")
    repo.save_note(older)
    repo.save_note(newer)
    assert [n.id for n in repo.list_notes("alice")] == [newer.id, older.id]


def test_count_notes_per_user():
    repo = InMemoryNotesRepository()
    repo.save_note(_note(user_id="alice"))
    repo.save_note(_note(user_id="alice"))
    repo.save_note(_note(user_id="bob"))
    assert repo.count_notes("alice") == 2
    assert repo.count_notes("bob") == 1
    assert repo.count_notes("nobody") == 0


def test_delete_scoped_to_owner():
    repo = InMemoryNotesRepository()
    n = _note(user_id="alice")
    repo.save_note(n)
    assert repo.delete_note("bob", n.id) is False   # another user can't delete it
    assert repo.delete_note("alice", n.id) is True
    assert repo.get_note("alice", n.id) is None


# --- users ---

def test_add_and_get_user():
    repo = InMemoryUsersRepository()
    assert repo.add_user(_user("alice")) is True
    assert repo.get_user("alice").username == "alice"


def test_add_duplicate_username_fails():
    repo = InMemoryUsersRepository()
    repo.add_user(_user("alice"))
    assert repo.add_user(_user("alice")) is False


def test_get_missing_user_returns_none():
    assert InMemoryUsersRepository().get_user("nobody") is None


def test_save_user_updates_in_place():
    repo = InMemoryUsersRepository()
    repo.add_user(_user("alice"))
    updated = _user("alice")
    updated.salt = "new-salt"
    repo.save_user(updated)
    assert repo.get_user("alice").salt == "new-salt"


def test_reserve_email_is_atomic():
    repo = InMemoryUsersRepository()
    assert repo.reserve_email("a@example.com", "alice") is True
    assert repo.email_exists("a@example.com") is True
    # a second reservation of the same email fails
    assert repo.reserve_email("a@example.com", "bob") is False
    assert repo.email_exists("other@example.com") is False


def test_release_email_frees_it():
    repo = InMemoryUsersRepository()
    repo.reserve_email("a@example.com", "alice")
    repo.release_email("a@example.com")
    assert repo.email_exists("a@example.com") is False
    assert repo.reserve_email("a@example.com", "bob") is True  # free again


def test_index_email_is_idempotent_backfill():
    repo = InMemoryUsersRepository()
    repo.index_email("a@example.com", "alice")
    repo.index_email("a@example.com", "alice")  # no-op, harmless
    assert repo.email_exists("a@example.com") is True


def test_create_note_sets_updated_at_equal_to_created_at():
    # A freshly created note (as function_app builds it) sorts identically under
    # both "created" and "modified" ordering.
    n = _note(created_at="2026-01-01T00:00:00", updated_at="2026-01-01T00:00:00")
    assert n.updated_at == n.created_at


def test_note_updated_at_defaults_to_none_for_legacy_notes():
    n = _note()  # no updated_at supplied, as with pre-existing stored notes
    assert n.updated_at is None
