from ratelimit import RateLimiter


def test_allows_up_to_limit_then_denies():
    rl = RateLimiter(max_calls=3, window_seconds=60)
    assert [rl.allow("ip", now=0) for _ in range(3)] == [True, True, True]
    assert rl.allow("ip", now=0) is False


def test_keys_are_independent():
    rl = RateLimiter(max_calls=1, window_seconds=60)
    assert rl.allow("a", now=0) is True
    assert rl.allow("b", now=0) is True
    assert rl.allow("a", now=0) is False


def test_window_expiry_frees_capacity():
    rl = RateLimiter(max_calls=1, window_seconds=10)
    assert rl.allow("ip", now=0) is True
    assert rl.allow("ip", now=5) is False
    assert rl.allow("ip", now=11) is True
