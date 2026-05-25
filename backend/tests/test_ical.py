"""
Tests for the iCal router (/ical).

  POST /ical/revoke         → increment token version, return new token
  GET  /ical/token          → return current token (premium only)
  GET  /ical/feed/{token}   → public .ics feed

Token helpers _make_token / _verify_token are also tested directly.
"""

from datetime import date

import pytest

from tests.conftest import make_client


# ── Helpers ───────────────────────────────────────────────────────────────────


def _seed_user(db, uid="test-uid-1", tier="free", ical_version=1):
    from app.models.user import User

    db.add(User(
        id=uid,
        username="alice",
        email="alice@test.com",
        subscription_tier=tier,
        ical_token_version=ical_version,
    ))
    db.commit()


def _get_valid_token(db, uid="test-uid-1") -> str:
    from app.routers.ical import _make_token
    from app.models.user import User

    user = db.query(User).filter_by(id=uid).first()
    version = user.ical_token_version if user else 1
    return _make_token(uid, version)


# ── Token helper unit tests ───────────────────────────────────────────────────


class TestTokenHelpers:
    def test_make_and_verify_roundtrip(self, db):
        from app.routers.ical import _make_token, _verify_token

        _seed_user(db)
        token = _make_token("test-uid-1", 1)
        result = _verify_token(token, db)
        assert result == "test-uid-1"

    def test_verify_wrong_secret_returns_none(self, db):
        from app.routers.ical import _verify_token
        from unittest.mock import patch

        _seed_user(db)
        # Build a token with the wrong secret
        import base64
        import hmac as hmac_mod
        import hashlib

        uid = "test-uid-1"
        version = 1
        uid_b64 = base64.urlsafe_b64encode(uid.encode()).decode().rstrip("=")
        payload = f"{uid}:{version}".encode()
        sig = hmac_mod.new(b"wrong-secret", payload, hashlib.sha256).hexdigest()[:32]
        bad_token = f"{uid_b64}.{version}.{sig}"

        assert _verify_token(bad_token, db) is None

    def test_verify_old_version_returns_none(self, db):
        from app.routers.ical import _make_token, _verify_token

        _seed_user(db, ical_version=2)
        old_token = _make_token("test-uid-1", 1)  # version 1 but DB has version 2
        assert _verify_token(old_token, db) is None

    def test_verify_malformed_token_returns_none(self, db):
        from app.routers.ical import _verify_token

        _seed_user(db)
        assert _verify_token("not-a-valid-token", db) is None
        assert _verify_token("", db) is None

    def test_verify_nonexistent_user_returns_none(self, db):
        from app.routers.ical import _make_token, _verify_token

        token = _make_token("ghost-uid", 1)
        assert _verify_token(token, db) is None


# ── POST /ical/revoke ─────────────────────────────────────────────────────────


class TestRevokeToken:
    def test_revoke_increments_version(self, client, db):
        _seed_user(db, ical_version=1)
        r = client.post("/ical/revoke")
        assert r.status_code == 200
        from app.models.user import User

        user = db.query(User).filter_by(id="test-uid-1").first()
        db.refresh(user)
        assert user.ical_token_version == 2

    def test_revoke_returns_new_valid_token(self, client, db):
        from app.routers.ical import _verify_token

        _seed_user(db, ical_version=1)
        r = client.post("/ical/revoke")
        assert r.status_code == 200
        new_token = r.json()["token"]
        # The new token should now verify (version == 2)
        from tests.conftest import TestingSessionLocal

        with TestingSessionLocal() as verify_db:
            assert _verify_token(new_token, verify_db) == "test-uid-1"

    def test_old_token_invalid_after_revoke(self, client, db):
        from app.routers.ical import _verify_token

        _seed_user(db, ical_version=1)
        old_token = _get_valid_token(db)
        client.post("/ical/revoke")
        from tests.conftest import TestingSessionLocal

        with TestingSessionLocal() as verify_db:
            assert _verify_token(old_token, verify_db) is None

    def test_revoke_missing_user_returns_404(self, client):
        r = client.post("/ical/revoke")
        assert r.status_code == 404


# ── GET /ical/token ───────────────────────────────────────────────────────────


class TestGetToken:
    @pytest.mark.skip(
        reason="open beta: is_premium hardcoded True (see subscription.py)"
    )
    def test_free_user_returns_403(self, client, db):
        _seed_user(db, tier="free")
        r = client.get("/ical/token")
        assert r.status_code == 403

    def test_premium_user_gets_token(self, client, db):
        _seed_user(db, tier="premium")
        r = client.get("/ical/token")
        assert r.status_code == 200
        assert "token" in r.json()

    def test_token_is_string(self, client, db):
        _seed_user(db, tier="premium")
        r = client.get("/ical/token")
        assert isinstance(r.json()["token"], str)
        assert len(r.json()["token"]) > 10


# ── GET /ical/feed/{token} ────────────────────────────────────────────────────


class TestIcalFeed:
    def test_invalid_token_returns_401(self, client, db):
        _seed_user(db)
        r = client.get("/ical/feed/invalid-token-xyz")
        assert r.status_code == 401

    def test_valid_token_returns_ics(self, client, db):
        _seed_user(db, tier="premium")
        token = _get_valid_token(db)
        r = client.get(f"/ical/feed/{token}")
        assert r.status_code == 200
        assert "text/calendar" in r.headers["content-type"]
        assert b"BEGIN:VCALENDAR" in r.content

    def test_empty_watchlist_returns_valid_calendar(self, client, db):
        _seed_user(db, tier="free")  # tier doesn't matter for feed (public endpoint)
        token = _get_valid_token(db)
        r = client.get(f"/ical/feed/{token}")
        assert r.status_code == 200
        assert b"BEGIN:VCALENDAR" in r.content
        assert b"END:VCALENDAR" in r.content

    def test_feed_includes_watchlisted_movie(self, client, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist

        _seed_user(db)
        # Give the movie a future release date so it shows up
        db.query(Movie).filter_by(id=550).update({"release_date": date(2030, 6, 15)})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        token = _get_valid_token(db)
        r = client.get(f"/ical/feed/{token}")
        assert r.status_code == 200
        assert b"Fight Club" in r.content

    def test_feed_includes_watchlisted_show_episodes(self, client, db, seed_show):
        from app.models.episode import Episode
        from app.models.watchlist import Watchlist

        _seed_user(db)
        db.query(Episode).filter_by(id=62085).update({"air_date": date(2030, 8, 1)})
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()

        token = _get_valid_token(db)
        r = client.get(f"/ical/feed/{token}")
        assert r.status_code == 200
        assert b"Breaking Bad" in r.content

    def test_feed_uid_format_in_events(self, client, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist

        _seed_user(db)
        db.query(Movie).filter_by(id=550).update({"release_date": date(2030, 6, 15)})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        token = _get_valid_token(db)
        r = client.get(f"/ical/feed/{token}")
        assert b"movie-550@releaseradar" in r.content
