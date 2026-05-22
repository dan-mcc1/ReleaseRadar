"""
Tests for activity_service and the friends-feed API endpoints.

Endpoints under test:
  GET /friends/my-activity   → get_my_activity
  GET /friends/activity      → get_friends_activity
  GET /friends/feed          → get_activity_feed
"""

from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import make_client


# ── Helpers ───────────────────────────────────────────────────────────────────


def _seed_users(db):
    from app.models.user import User

    db.add(User(id="test-uid-1", username="alice", email="alice@test.com"))
    db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
    db.commit()


def _make_friends(db):
    from app.models.friendship import Friendship

    _seed_users(db)
    db.add(Friendship(requester_id="test-uid-1", addressee_id="test-uid-2", status="accepted"))
    db.commit()


def _log(db, uid, activity_type, content_type="movie", content_id=550, **kwargs):
    from app.services.activity_service import log_activity

    log_activity(db, uid, activity_type, content_type, content_id, content_title="Test", **kwargs)
    db.commit()


# ── Service-level tests ───────────────────────────────────────────────────────


class TestLogActivity:
    def test_creates_entry(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "watched")
        assert db.query(Activity).count() == 1

    def test_deduplicates_same_type_and_content(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "want_to_watch")
        _log(db, "test-uid-1", "want_to_watch")
        assert db.query(Activity).count() == 1

    def test_watched_collapses_preceding_currently_watching(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "currently_watching")
        _log(db, "test-uid-1", "want_to_watch")
        _log(db, "test-uid-1", "watched")
        # Only the "watched" row should remain
        rows = db.query(Activity).filter_by(user_id="test-uid-1").all()
        assert len(rows) == 1
        assert rows[0].activity_type == "watched"

    def test_episode_watched_keyed_by_season_and_episode(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "episode_watched", "tv", 1396, season_number=1, episode_number=1)
        _log(db, "test-uid-1", "episode_watched", "tv", 1396, season_number=1, episode_number=2)
        # Two different episodes → two rows
        assert db.query(Activity).filter_by(activity_type="episode_watched").count() == 2

    def test_episode_watched_deduplicates_same_episode(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "episode_watched", "tv", 1396, season_number=1, episode_number=1)
        _log(db, "test-uid-1", "episode_watched", "tv", 1396, season_number=1, episode_number=1)
        assert db.query(Activity).filter_by(activity_type="episode_watched").count() == 1

    def test_rating_stored(self, db):
        from app.models.activity import Activity

        _seed_users(db)
        _log(db, "test-uid-1", "watched", rating=4.5)
        row = db.query(Activity).first()
        assert row.rating == 4.5


class TestGetMyActivity:
    def test_returns_own_activity(self, db):
        from app.services.activity_service import get_my_activity

        _seed_users(db)
        _log(db, "test-uid-1", "watched")
        result = get_my_activity(db, "test-uid-1")
        assert len(result) == 1
        assert result[0]["activity_type"] == "watched"
        assert result[0]["username"] == "alice"

    def test_excludes_other_users(self, db):
        from app.services.activity_service import get_my_activity

        _seed_users(db)
        _log(db, "test-uid-2", "watched")  # bob's activity
        result = get_my_activity(db, "test-uid-1")
        assert result == []

    def test_ordered_newest_first(self, db):
        from app.models.activity import Activity
        from app.services.activity_service import get_my_activity

        _seed_users(db)
        now = datetime.now(timezone.utc)
        db.add(Activity(user_id="test-uid-1", activity_type="want_to_watch",
                        content_type="movie", content_id=550, created_at=now - timedelta(hours=2)))
        db.add(Activity(user_id="test-uid-1", activity_type="watched",
                        content_type="movie", content_id=551, created_at=now))
        db.commit()
        result = get_my_activity(db, "test-uid-1")
        assert result[0]["activity_type"] == "watched"


class TestGetFriendsActivity:
    def test_empty_without_friends(self, db):
        from app.services.activity_service import get_friends_activity

        _seed_users(db)
        _log(db, "test-uid-2", "watched")
        result = get_friends_activity(db, "test-uid-1")
        assert result == []

    def test_shows_accepted_friend_activity(self, db):
        from app.services.activity_service import get_friends_activity

        _make_friends(db)
        _log(db, "test-uid-2", "watched")
        result = get_friends_activity(db, "test-uid-1")
        assert len(result) == 1
        assert result[0]["username"] == "bob"

    def test_excludes_private_profiles(self, db):
        from app.models.user import User
        from app.services.activity_service import get_friends_activity

        _make_friends(db)
        _log(db, "test-uid-2", "watched")
        db.query(User).filter_by(id="test-uid-2").update({"profile_visibility": "private"})
        db.commit()
        result = get_friends_activity(db, "test-uid-1")
        assert result == []

    def test_excludes_pending_friend_requests(self, db):
        from app.models.friendship import Friendship
        from app.services.activity_service import get_friends_activity

        _seed_users(db)
        db.add(Friendship(requester_id="test-uid-1", addressee_id="test-uid-2", status="pending"))
        db.commit()
        _log(db, "test-uid-2", "watched")
        result = get_friends_activity(db, "test-uid-1")
        assert result == []


class TestGetActivityFeed:
    def test_includes_own_activity(self, db):
        from app.services.activity_service import get_activity_feed

        _seed_users(db)
        _log(db, "test-uid-1", "watched")
        result = get_activity_feed(db, "test-uid-1")
        assert any(r["user_id"] == "test-uid-1" for r in result)

    def test_includes_friend_activity(self, db):
        from app.services.activity_service import get_activity_feed

        _make_friends(db)
        _log(db, "test-uid-1", "watched")
        _log(db, "test-uid-2", "want_to_watch")
        result = get_activity_feed(db, "test-uid-1")
        user_ids = {r["user_id"] for r in result}
        assert "test-uid-1" in user_ids
        assert "test-uid-2" in user_ids

    def test_excludes_non_friends(self, db):
        from app.services.activity_service import get_activity_feed

        _seed_users(db)
        _log(db, "test-uid-2", "watched")
        result = get_activity_feed(db, "test-uid-1")
        assert all(r["user_id"] == "test-uid-1" for r in result)


class TestDeleteOldActivity:
    def test_removes_old_entries(self, db):
        from app.models.activity import Activity
        from app.services.activity_service import delete_old_activity

        _seed_users(db)
        old = datetime.now(timezone.utc) - timedelta(days=10)
        db.add(Activity(user_id="test-uid-1", activity_type="watched",
                        content_type="movie", content_id=550, created_at=old))
        db.commit()
        deleted = delete_old_activity(db, days=7)
        assert deleted == 1
        assert db.query(Activity).count() == 0

    def test_keeps_recent_entries(self, db):
        from app.models.activity import Activity
        from app.services.activity_service import delete_old_activity

        _seed_users(db)
        recent = datetime.now(timezone.utc) - timedelta(days=2)
        db.add(Activity(user_id="test-uid-1", activity_type="watched",
                        content_type="movie", content_id=550, created_at=recent))
        db.commit()
        deleted = delete_old_activity(db, days=7)
        assert deleted == 0
        assert db.query(Activity).count() == 1


class TestLiftExpiredModeration:
    def test_lifts_expired_suspension(self, db):
        from app.models.user import User
        from app.services.activity_service import lift_expired_moderation

        past = datetime.now(timezone.utc) - timedelta(hours=1)
        db.add(User(id="test-uid-1", username="alice", email="a@test.com",
                    is_suspended=True, suspended_until=past, suspension_reason="spam"))
        db.commit()
        lift_expired_moderation(db)
        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.is_suspended is False
        assert user.suspended_until is None
        assert user.suspension_reason is None

    def test_does_not_lift_active_suspension(self, db):
        from app.models.user import User
        from app.services.activity_service import lift_expired_moderation

        future = datetime.now(timezone.utc) + timedelta(days=1)
        db.add(User(id="test-uid-1", username="alice", email="a@test.com",
                    is_suspended=True, suspended_until=future))
        db.commit()
        lift_expired_moderation(db)
        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.is_suspended is True

    def test_clears_expired_silence(self, db):
        from app.models.user import User
        from app.services.activity_service import lift_expired_moderation

        past = datetime.now(timezone.utc) - timedelta(hours=1)
        db.add(User(id="test-uid-1", username="alice", email="a@test.com",
                    is_silenced=True, silenced_until=past))
        db.commit()
        lift_expired_moderation(db)
        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.is_silenced is False
        assert user.silenced_until is None


# ── HTTP endpoint tests ───────────────────────────────────────────────────────


class TestMyActivityEndpoint:
    def test_returns_200_empty(self, client, db):
        _seed_users(db)
        r = client.get("/friends/my-activity")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_own_entries(self, client, db):
        _seed_users(db)
        _log(db, "test-uid-1", "watched")
        r = client.get("/friends/my-activity")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["activity_type"] == "watched"


class TestFriendsActivityEndpoint:
    def test_empty_without_friends(self, client, db):
        _seed_users(db)
        _log(db, "test-uid-2", "watched")
        r = client.get("/friends/activity")
        assert r.status_code == 200
        assert r.json() == []

    def test_shows_accepted_friend(self, client, db):
        _make_friends(db)
        _log(db, "test-uid-2", "watched")
        r = client.get("/friends/activity")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["username"] == "bob"


class TestActivityFeedEndpoint:
    def test_feed_includes_own_and_friends(self, client, db):
        _make_friends(db)
        _log(db, "test-uid-1", "watched")
        _log(db, "test-uid-2", "want_to_watch")
        r = client.get("/friends/feed")
        assert r.status_code == 200
        user_ids = {item["user_id"] for item in r.json()}
        assert "test-uid-1" in user_ids
        assert "test-uid-2" in user_ids
