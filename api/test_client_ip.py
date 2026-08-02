"""Tests for _client_ip: ensure the rightmost (Azure-trusted) hop is used.

Azure SWA/Functions appends the verified client IP as the rightmost hop in
X-Forwarded-For. Client-supplied values appear on the left and must be ignored.
"""
import azure.functions as func


def _client_ip(req: func.HttpRequest) -> str:
    """Parse the RIGHTMOST (trusted) hop from X-Forwarded-For."""
    header = req.headers.get("X-Forwarded-For", "")
    parts = [p.strip() for p in header.split(",") if p.strip()]
    return parts[-1] if parts else "unknown"


def _make_req(xff: str):
    return func.HttpRequest(
        method="GET",
        url="http://localhost/api/test",
        headers={"X-Forwarded-For": xff},
        body=b"",
    )


def test_single_ip_returned():
    req = _make_req("1.2.3.4")
    assert _client_ip(req) == "1.2.3.4"


def test_rightmost_hop_chosen():
    # Client supplies fake left IPs; Azure appends the real one on the right.
    req = _make_req("attacker-fake, 10.0.0.1, 20.0.0.2")
    assert _client_ip(req) == "20.0.0.2"


def test_spaces_stripped():
    req = _make_req("  1.2.3.4  ,  5.6.7.8  ")
    assert _client_ip(req) == "5.6.7.8"


def test_empty_header_returns_unknown():
    req = _make_req("")
    assert _client_ip(req) == "unknown"


def test_missing_header_returns_unknown():
    req = func.HttpRequest(
        method="GET",
        url="http://localhost/api/test",
        headers={},
        body=b"",
    )
    assert _client_ip(req) == "unknown"
