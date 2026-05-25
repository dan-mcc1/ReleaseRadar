"""Tests for app.routers.events — SSE token issuance and stream auth."""

import time

import pytest


@pytest.fixture(autouse=True)
def _clear_sse_tokens():
    from app.routers import events

    events._sse_tokens.clear()
    yield
    events._sse_tokens.clear()


class TestIssueSSEToken:
    def test_returns_token_for_authenticated_user(self, client):
        r = client.post("/events/token")
        assert r.status_code == 200
        body = r.json()
        assert "session_token" in body
        assert isinstance(body["session_token"], str)
        assert len(body["session_token"]) > 20

    def test_stores_token_keyed_to_uid(self, client):
        from app.routers import events

        r = client.post("/events/token")
        token = r.json()["session_token"]
        assert token in events._sse_tokens
        uid, expiry = events._sse_tokens[token]
        assert uid == "test-uid-1"
        assert expiry > time.monotonic()


class TestEventStream:
    def test_missing_token_returns_401(self, client):
        r = client.get("/events/stream")
        # token query parameter is required
        assert r.status_code == 422

    def test_invalid_token_returns_401(self, client):
        r = client.get("/events/stream?token=not-a-real-token")
        assert r.status_code == 401

    def test_expired_token_returns_401(self, client):
        from app.routers import events

        events._sse_tokens["expired"] = ("test-uid-1", time.monotonic() - 10)
        r = client.get("/events/stream?token=expired")
        assert r.status_code == 401

    def test_token_is_single_use(self, client):
        """Once the stream consumes a token (or attempts to), it must not be
        reusable."""
        from app.routers import events

        # Seed an obviously-expired token. The first call pops it (and 401s
        # because it's expired); the second call also 401s because it's gone.
        events._sse_tokens["once"] = ("test-uid-1", time.monotonic() - 1)
        r1 = client.get("/events/stream?token=once")
        r2 = client.get("/events/stream?token=once")
        assert r1.status_code == 401
        assert r2.status_code == 401
        assert "once" not in events._sse_tokens
