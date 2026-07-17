import pytest
from pydantic import ValidationError

from models import Feedback, FeedbackRequest
from ratelimit import RateLimiter
from repository import InMemoryFeedbackRepository


# --- request validation ---

def test_request_accepts_a_normal_message():
    assert FeedbackRequest(message="the editor is great").message == "the editor is great"


def test_request_rejects_an_empty_message():
    with pytest.raises(ValidationError):
        FeedbackRequest(message="")


def test_request_accepts_exactly_the_limit():
    assert len(FeedbackRequest(message="x" * 4000).message) == 4000


def test_request_rejects_over_the_limit():
    with pytest.raises(ValidationError):
        FeedbackRequest(message="x" * 4001)


# --- repository ---

def test_add_feedback_stores_the_message():
    repo = InMemoryFeedbackRepository()
    repo.add_feedback(Feedback(user_id="alice", message="hello"))
    assert [(f.user_id, f.message) for f in repo.items] == [("alice", "hello")]


def test_add_feedback_keeps_every_message():
    repo = InMemoryFeedbackRepository()
    repo.add_feedback(Feedback(user_id="alice", message="one"))
    repo.add_feedback(Feedback(user_id="alice", message="two"))
    assert [f.message for f in repo.items] == ["one", "two"]


def test_feedback_gets_an_id_and_timestamp():
    fb = Feedback(user_id="alice", message="hello")
    assert fb.id
    assert fb.created_at is not None


# --- rate limiting (the endpoint wires this in Task 3) ---

def test_rate_limiter_allows_five_then_denies():
    rl = RateLimiter(max_calls=5, window_seconds=600)
    assert [rl.allow("alice", now=0) for _ in range(5)] == [True] * 5
    assert rl.allow("alice", now=0) is False


def test_rate_limiter_is_per_user():
    rl = RateLimiter(max_calls=5, window_seconds=600)
    for _ in range(5):
        rl.allow("alice", now=0)
    assert rl.allow("bob", now=0) is True
