from typing import Optional
from models import Note


def find_note(notes: list[Note], note_id: str) -> Optional[Note]:
    """Return the note with the given id, or None if it is not present."""
    for note in notes:
        if note.id == note_id:
            return note
    return None
