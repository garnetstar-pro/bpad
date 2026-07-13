import pytest
from pydantic import ValidationError
from models import PreferencesRequest


def test_preferences_accepts_known_values():
    assert PreferencesRequest(sortBy="created").sortBy == "created"
    assert PreferencesRequest(sortBy="modified").sortBy == "modified"


def test_preferences_rejects_unknown_value():
    with pytest.raises(ValidationError):
        PreferencesRequest(sortBy="alphabetical")
