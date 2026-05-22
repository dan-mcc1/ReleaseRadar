"""
Tests for notifications router and helper functions.

Endpoints:
  GET  /notifications/preferences
  PATCH /notifications/preferences
  POST /notifications/send-digest
  GET  /notifications/unsubscribe

Helper functions tested directly:
  _should_send_today
  _frequency_window
  _build_items_for_window
  send_daily_digest_to_all
"""

import hashlib
import hmac
import os
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

from tests.conftest import make_client


# ── Seed helpers ──────────────────────────────────────────────────────────────


def _seed_user(db, uid="test-uid-1", **kwargs):
    from app.models.user import User

    defaults = dict(
        id=uid,
        username="alice",
        email="alice@test.com",
        email_notifications=True,
        notification_frequency="daily",
    )
    defaults.update(kwargs)
    db.add(User(**defaults))
    db.commit()


def _make_unsubscribe_token(uid: str) -> str:
    from app.config import settings

    return hmac.new(
        settings.UNSUBSCRIBE_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()


# ── Helper function unit tests ────────────────────────────────────────────────


class TestShouldSendToday:
    def test_daily_always_true(self):
        from app.routers.notifications import _should_send_today

        for weekday in range(7):
            d = date(2024, 1, 1) + timedelta(days=weekday)
            assert _should_send_today("daily", d) is True

    def test_weekly_only_on_monday(self):
        from app.routers.notifications import _should_send_today

        monday = date(2024, 1, 1)       # weekday() == 0
        tuesday = date(2024, 1, 2)      # weekday() == 1
        assert _should_send_today("weekly", monday) is True
        assert _should_send_today("weekly", tuesday) is False

    def test_monthly_only_on_first(self):
        from app.routers.notifications import _should_send_today

        first = date(2024, 2, 1)
        second = date(2024, 2, 2)
        assert _should_send_today("monthly", first) is True
        assert _should_send_today("monthly", second) is False

    def test_unknown_frequency_returns_false(self):
        from app.routers.notifications import _should_send_today

        assert _should_send_today("hourly", date(2024, 1, 1)) is False


class TestFrequencyWindow:
    def test_daily_returns_1(self):
        from app.routers.notifications import _frequency_window

        assert _frequency_window("daily") == 1

    def test_weekly_returns_7(self):
        from app.routers.notifications import _frequency_window

        assert _frequency_window("weekly") == 7

    def test_monthly_returns_30(self):
        from app.routers.notifications import _frequency_window

        assert _frequency_window("monthly") == 30

    def test_unknown_returns_1(self):
        from app.routers.notifications import _frequency_window

        assert _frequency_window("quarterly") == 1


class TestBuildItemsForWindow:
    def test_empty_watchlist_returns_empty(self, db):
        from app.routers.notifications import _build_items_for_window

        _seed_user(db)
        result = _build_items_for_window(db, "test-uid-1", days=7)
        assert result == []

    def test_upcoming_movie_in_window_included(self, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from app.routers.notifications import _build_items_for_window

        _seed_user(db)
        # Set release_date to tomorrow
        tomorrow = date.today() + timedelta(days=1)
        db.query(Movie).filter_by(id=550).update({"release_date": tomorrow})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, notify=True))
        db.commit()
        result = _build_items_for_window(db, "test-uid-1", days=7)
        assert len(result) == 1
        assert result[0]["content_type"] == "movie"
        assert result[0]["content_id"] == 550

    def test_past_movie_not_included(self, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from app.routers.notifications import _build_items_for_window

        _seed_user(db)
        yesterday = date.today() - timedelta(days=1)
        db.query(Movie).filter_by(id=550).update({"release_date": yesterday})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, notify=True))
        db.commit()
        result = _build_items_for_window(db, "test-uid-1", days=7)
        assert result == []

    def test_movie_with_notify_false_not_included(self, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from app.routers.notifications import _build_items_for_window

        _seed_user(db)
        tomorrow = date.today() + timedelta(days=1)
        db.query(Movie).filter_by(id=550).update({"release_date": tomorrow})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, notify=False))
        db.commit()
        result = _build_items_for_window(db, "test-uid-1", days=7)
        assert result == []

    def test_upcoming_episode_in_window_included(self, db, seed_show):
        from app.models.episode import Episode
        from app.models.watchlist import Watchlist
        from app.routers.notifications import _build_items_for_window

        _seed_user(db)
        tomorrow = date.today() + timedelta(days=1)
        db.query(Episode).filter_by(id=62085).update({"air_date": tomorrow})
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396, notify=True))
        db.commit()
        result = _build_items_for_window(db, "test-uid-1", days=7)
        tv_items = [r for r in result if r["content_type"] == "tv"]
        assert len(tv_items) >= 1


# ── Preferences endpoint tests ────────────────────────────────────────────────


class TestGetPreferences:
    def test_returns_defaults(self, client, db):
        _seed_user(db)
        r = client.get("/notifications/preferences")
        assert r.status_code == 200
        data = r.json()
        assert "email_notifications" in data
        assert "notification_frequency" in data
        assert "profile_visibility" in data

    def test_returns_404_for_missing_user(self, client):
        r = client.get("/notifications/preferences")
        assert r.status_code == 404


class TestUpdatePreferences:
    def test_toggle_email_notifications(self, client, db):
        _seed_user(db, email_notifications=False)
        r = client.patch("/notifications/preferences", json={"email_notifications": True})
        assert r.status_code == 200
        assert r.json()["email_notifications"] is True

    def test_update_frequency_valid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"notification_frequency": "weekly"})
        assert r.status_code == 200
        assert r.json()["notification_frequency"] == "weekly"

    def test_update_frequency_invalid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"notification_frequency": "hourly"})
        assert r.status_code == 422

    def test_update_visibility_valid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"profile_visibility": "public"})
        assert r.status_code == 200
        assert r.json()["profile_visibility"] == "public"

    def test_update_visibility_invalid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"profile_visibility": "secret"})
        assert r.status_code == 422

    def test_update_digest_hour_valid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"digest_hour": 8})
        assert r.status_code == 200
        assert r.json()["digest_hour"] == 8

    def test_update_digest_hour_out_of_range(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"digest_hour": 25})
        assert r.status_code == 422

    def test_update_timezone_valid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"digest_timezone": "America/Chicago"})
        assert r.status_code == 200
        assert r.json()["digest_timezone"] == "America/Chicago"

    def test_update_timezone_invalid(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"digest_timezone": "Moon/Crater"})
        assert r.status_code == 422

    def test_notify_new_seasons_requires_premium(self, client, db):
        _seed_user(db)  # free tier by default
        r = client.patch("/notifications/preferences", json={"notify_new_seasons": True})
        assert r.status_code == 403
        assert r.json()["detail"]["error"] == "premium_required"

    def test_notify_new_seasons_allowed_for_premium(self, client, db):
        _seed_user(db, subscription_tier="premium")
        r = client.patch("/notifications/preferences", json={"notify_new_seasons": True})
        assert r.status_code == 200
        assert r.json()["notify_new_seasons"] is True

    def test_notify_streaming_changes_requires_premium(self, client, db):
        _seed_user(db)
        r = client.patch("/notifications/preferences", json={"notify_streaming_changes": True})
        assert r.status_code == 403

    def test_returns_404_for_missing_user(self, client):
        r = client.patch("/notifications/preferences", json={"email_notifications": True})
        assert r.status_code == 404


# ── Send digest endpoint ──────────────────────────────────────────────────────


class TestSendDigest:
    def test_queues_digest(self, client, db):
        _seed_user(db, email_notifications=True, email="alice@test.com")
        with patch("app.routers.notifications.send_notification_email") as mock_send:
            r = client.post("/notifications/send-digest")
        assert r.status_code == 200
        assert "queued" in r.json()["message"].lower()

    def test_disabled_notifications_returns_400(self, client, db):
        _seed_user(db, email_notifications=False)
        r = client.post("/notifications/send-digest")
        assert r.status_code == 400

    def test_no_email_returns_400(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice", email=None, email_notifications=True))
        db.commit()
        r = client.post("/notifications/send-digest")
        assert r.status_code == 400

    def test_missing_user_returns_404(self, client):
        r = client.post("/notifications/send-digest")
        assert r.status_code == 404


# ── Unsubscribe endpoint ──────────────────────────────────────────────────────


class TestUnsubscribe:
    def test_valid_token_unsubscribes(self, client, db):
        _seed_user(db, email_notifications=True)
        token = _make_unsubscribe_token("test-uid-1")
        r = client.get(f"/notifications/unsubscribe?uid=test-uid-1&token={token}")
        assert r.status_code == 200
        from app.models.user import User

        user = db.query(User).filter_by(id="test-uid-1").first()
        db.refresh(user)
        assert user.email_notifications is False

    def test_invalid_token_returns_400(self, client, db):
        _seed_user(db)
        r = client.get("/notifications/unsubscribe?uid=test-uid-1&token=badtoken")
        assert r.status_code == 400

    def test_missing_user_returns_404(self, client):
        token = _make_unsubscribe_token("nonexistent-uid")
        r = client.get(f"/notifications/unsubscribe?uid=nonexistent-uid&token={token}")
        assert r.status_code == 404


# ── send_daily_digest_to_all ──────────────────────────────────────────────────


class TestSendDailyDigestToAll:
    def test_sends_to_eligible_user_at_correct_hour(self, db):
        from app.models.user import User
        from app.routers.notifications import send_daily_digest_to_all

        db.add(User(
            id="test-uid-1",
            username="alice",
            email="alice@test.com",
            email_notifications=True,
            notification_frequency="daily",
            digest_hour=9,
            digest_timezone="America/New_York",
        ))
        db.commit()

        # Simulate UTC time that maps to 9am Eastern (UTC-4 in summer)
        now_utc = datetime(2024, 6, 1, 13, 0, 0, tzinfo=timezone.utc)
        with patch("app.routers.notifications.send_notification_email") as mock_send:
            with patch("app.routers.notifications._build_items_for_window", return_value=[{"title": "Show"}]):
                send_daily_digest_to_all(db, now_utc=now_utc)
        mock_send.assert_called_once()

    def test_skips_user_at_wrong_hour(self, db):
        from app.models.user import User
        from app.routers.notifications import send_daily_digest_to_all

        db.add(User(
            id="test-uid-1",
            username="alice",
            email="alice@test.com",
            email_notifications=True,
            digest_hour=9,
            digest_timezone="America/New_York",
        ))
        db.commit()

        # UTC 12:00 → 8am Eastern → not 9am yet
        now_utc = datetime(2024, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        with patch("app.routers.notifications.send_notification_email") as mock_send:
            send_daily_digest_to_all(db, now_utc=now_utc)
        mock_send.assert_not_called()

    def test_skips_user_already_sent_today(self, db):
        from app.models.user import User
        from app.routers.notifications import send_daily_digest_to_all

        today = date(2024, 6, 1)
        db.add(User(
            id="test-uid-1",
            username="alice",
            email="alice@test.com",
            email_notifications=True,
            digest_hour=9,
            digest_timezone="America/New_York",
            last_digest_sent_at=today,
        ))
        db.commit()

        now_utc = datetime(2024, 6, 1, 13, 0, 0, tzinfo=timezone.utc)
        with patch("app.routers.notifications.send_notification_email") as mock_send:
            send_daily_digest_to_all(db, now_utc=now_utc)
        mock_send.assert_not_called()

    def test_skips_user_with_no_email(self, db):
        from app.models.user import User
        from app.routers.notifications import send_daily_digest_to_all

        db.add(User(
            id="test-uid-1",
            username="alice",
            email=None,
            email_notifications=True,
            digest_hour=9,
            digest_timezone="America/New_York",
        ))
        db.commit()

        now_utc = datetime(2024, 6, 1, 13, 0, 0, tzinfo=timezone.utc)
        with patch("app.routers.notifications.send_notification_email") as mock_send:
            send_daily_digest_to_all(db, now_utc=now_utc)
        mock_send.assert_not_called()
