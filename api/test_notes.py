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
