import pytest
from pydantic import ValidationError

from models import NoteCreate


def test_note_accepts_a_normal_payload():
    note = NoteCreate(iv="x" * 16, ct="c" * 100)
    assert note.iv == "x" * 16
    assert len(note.ct) == 100


def test_note_accepts_ciphertext_exactly_at_the_limit():
    assert len(NoteCreate(iv="x" * 16, ct="c" * 65536).ct) == 65536


def test_note_rejects_ciphertext_over_the_limit():
    with pytest.raises(ValidationError):
        NoteCreate(iv="x" * 16, ct="c" * 65537)


def test_note_rejects_an_oversized_iv():
    with pytest.raises(ValidationError):
        NoteCreate(iv="x" * 65, ct="c" * 10)


import function_app as fa


def test_no_limit_hit_for_a_fresh_account():
    assert fa._note_limit_hit(0, verified=True) is None
    assert fa._note_limit_hit(0, verified=False) is None


def test_unverified_account_capped_at_ten():
    assert fa._note_limit_hit(9, verified=False) is None
    assert fa._note_limit_hit(10, verified=False) == "unverified"


def test_verified_account_allowed_past_the_unverified_cap():
    assert fa._note_limit_hit(500, verified=True) is None


def test_verified_account_capped_at_one_thousand():
    assert fa._note_limit_hit(999, verified=True) is None
    assert fa._note_limit_hit(1000, verified=True) == "hard"
