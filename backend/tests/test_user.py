"""
Tests for user endpoints: create, get, update username/email/avatar/bio,
profile visibility, account deletion, and tracking_count cleanup.
"""

import pytest
from tests.conftest import make_client


class TestUserCreate:
    def test_create_user(self, client):
        r = client.post(
            "/user/create", json={"email": "alice@test.com", "username": "alice"}
        )
        assert r.status_code == 200

    def test_create_user_no_username(self, client):
        r = client.post("/user/create", json={"email": "anon@test.com"})
        assert r.status_code == 200

    def test_create_duplicate_username_rejected(self, client, db):
        client.post("/user/create", json={"username": "alice", "email": "a@test.com"})
        # Second client with different uid trying same username
        c2 = make_client("test-uid-2")
        r = c2.post("/user/create", json={"username": "alice", "email": "b@test.com"})
        assert r.status_code == 409

    def test_create_invalid_username_rejected(self, client):
        r = client.post(
            "/user/create", json={"username": "ab", "email": "x@test.com"}
        )  # too short
        assert r.status_code == 422

    def test_create_username_with_spaces_rejected(self, client):
        r = client.post(
            "/user/create", json={"username": "bad name", "email": "x@test.com"}
        )
        assert r.status_code == 422

    def test_create_idempotent(self, client):
        client.post(
            "/user/create", json={"email": "alice@test.com", "username": "alice"}
        )
        r = client.post(
            "/user/create", json={"email": "alice@test.com", "username": "alice"}
        )
        # A retry after a lost response must not read as "username taken".
        assert r.status_code == 200
        assert r.json()["username"] == "alice"


def _claims_client(uid, email, verified):
    """A client whose token carries the given email and email_verified claim."""
    from app.dependencies.auth import get_token_claims
    from app.main import app

    c = make_client(uid)

    async def _claims():
        claims = {"uid": uid, "email": email}
        if verified is not None:
            claims["email_verified"] = verified
        return claims

    app.dependency_overrides[get_token_claims] = _claims
    return c


class TestVerifiedEmailOnly:
    def test_create_unverified_stores_no_email(self, db):
        c = _claims_client("uv-1", "stranger@test.com", False)
        assert c.post("/user/create", json={"username": "uv_one"}).status_code == 200
        assert c.get("/user/me").json()["email"] is None

    def test_create_missing_claim_stores_no_email(self, db):
        c = _claims_client("uv-2", "stranger@test.com", None)
        assert c.post("/user/create", json={}).status_code == 200
        assert c.get("/user/me").json()["email"] is None

    def test_create_verified_stores_email(self, db):
        c = _claims_client("uv-3", "real@test.com", True)
        assert c.post("/user/create", json={}).status_code == 200
        assert c.get("/user/me").json()["email"] == "real@test.com"

    def test_create_again_after_verifying_fills_email(self, db):
        c = _claims_client("uv-4", "later@test.com", False)
        c.post("/user/create", json={})
        assert c.get("/user/me").json()["email"] is None
        c = _claims_client("uv-4", "later@test.com", True)
        r = c.post("/user/create", json={})
        assert r.status_code == 200
        assert r.json()["email"] == "later@test.com"
        assert c.get("/user/me").json()["email"] == "later@test.com"

    def test_create_unverified_keeps_existing_email(self, db):
        from app.models.user import User

        db.add(User(id="uv-5", username="uv_five", email="old@test.com"))
        db.commit()
        c = _claims_client("uv-5", "other@test.com", False)
        r = c.post("/user/create", json={})
        assert r.status_code == 200
        assert r.json()["email"] == "old@test.com"

    def test_create_verified_does_not_overwrite_existing_email(self, db):
        from app.models.user import User

        db.add(User(id="uv-6", username="uv_six", email="old@test.com"))
        db.commit()
        c = _claims_client("uv-6", "new@test.com", True)
        assert c.post("/user/create", json={}).json()["email"] == "old@test.com"

    def _sync(self, db, uid, stored_email, record):
        from types import SimpleNamespace
        from unittest.mock import patch
        from app.models.user import User

        db.add(User(id=uid, username=uid.replace("-", "_"), email=stored_email))
        db.commit()
        c = make_client(uid)
        rec = SimpleNamespace(display_name=None, **record)
        with patch("app.routers.user.firebase_auth.get_user", return_value=rec):
            return c.post("/user/sync-from-firebase")

    def test_sync_unverified_does_not_copy_email(self, db):
        r = self._sync(
            db, "sy-1", None, {"email": "x@test.com", "email_verified": False}
        )
        assert r.status_code == 200
        assert r.json()["email"] is None

    def test_sync_unverified_does_not_clear_or_replace_email(self, db):
        r = self._sync(
            db, "sy-2", "old@test.com", {"email": "x@test.com", "email_verified": False}
        )
        assert r.json()["email"] == "old@test.com"
        r = self._sync(
            db, "sy-3", "old@test.com", {"email": None, "email_verified": False}
        )
        assert r.json()["email"] == "old@test.com"

    def test_sync_verified_copies_email(self, db):
        r = self._sync(
            db, "sy-4", None, {"email": "x@test.com", "email_verified": True}
        )
        assert r.json()["email"] == "x@test.com"

    def test_user_without_email_is_skipped_by_the_senders(self):
        from datetime import datetime, timezone
        from types import SimpleNamespace
        from app.services.digest_service import digest_due, premiere_eligible

        user = SimpleNamespace(
            email=None,
            email_notifications=True,
            notification_frequency="daily",
            digest_hour=9,
            digest_timezone="UTC",
            last_digest_sent_at=None,
            subscription_tier="premium",
            notify_new_seasons=True,
            push_notifications_enabled=False,
            push_notify_new_seasons=False,
        )
        now = datetime(2026, 1, 1, 9, 30, tzinfo=timezone.utc)
        assert digest_due(user, now) is None
        assert not premiere_eligible(user)
        user.email = "real@test.com"
        assert digest_due(user, now) is not None

    def test_push_only_user_without_email_is_premiere_eligible(self):
        from types import SimpleNamespace
        from app.services.digest_service import premiere_eligible

        user = SimpleNamespace(
            email=None,
            email_notifications=True,
            subscription_tier="premium",
            notify_new_seasons=True,
            push_notifications_enabled=True,
            push_notify_new_seasons=True,
        )
        assert premiere_eligible(user)

    def _streaming_user(self, db, uid, push):
        from app.models.user import User

        db.add(
            User(
                id=uid,
                username=uid.replace("-", "_"),
                email=None,
                subscription_tier="premium",
                email_notifications=True,
                notify_streaming_changes=True,
                push_notifications_enabled=push,
                push_notify_streaming_changes=push,
            )
        )
        db.commit()

    _ALERT = {
        "content_type": "movie",
        "content_id": 1,
        "title": "Fight Club",
        "poster_path": None,
        "added": ["Netflix"],
        "removed": [],
    }

    def test_streaming_sender_sends_no_email_without_stored_email(self, db):
        from unittest.mock import patch
        from app.services.streaming_notification_service import (
            send_user_streaming_alerts,
        )

        self._streaming_user(db, "ne-1", push=False)
        with patch(
            "app.services.streaming_notification_service.send_streaming_alert_email"
        ) as mail:
            with patch(
                "app.services.streaming_notification_service.push_notification"
            ) as push:
                send_user_streaming_alerts(db, "ne-1", [self._ALERT], "k")
        mail.assert_not_called()
        push.assert_not_called()

    def test_streaming_sender_still_pushes_without_stored_email(self, db):
        from unittest.mock import patch
        from app.services.streaming_notification_service import (
            send_user_streaming_alerts,
        )

        self._streaming_user(db, "ne-2", push=True)
        with patch(
            "app.services.streaming_notification_service.send_streaming_alert_email"
        ) as mail:
            with patch(
                "app.services.streaming_notification_service.push_notification"
            ) as push:
                send_user_streaming_alerts(db, "ne-2", [self._ALERT], "k")
        mail.assert_not_called()
        push.assert_called_once()


class TestUserGet:
    def test_get_me(self, client, seed_users):
        r = client.get("/user/me")
        assert r.status_code == 200
        assert r.json()["username"] == "alice"

    def test_get_me_not_found(self, client):
        r = client.get("/user/me")
        assert r.status_code == 404


class TestUserUpdateUsername:
    def test_update_username(self, client, seed_users):
        r = client.put("/user/update-username", json={"new_username": "alice2"})
        assert r.status_code == 200
        assert r.json()["username"] == "alice2"

    def test_update_username_taken(self, client, seed_users):
        r = client.put("/user/update-username", json={"new_username": "bob"})
        assert r.status_code == 409

    def test_update_username_invalid(self, client, seed_users):
        r = client.put("/user/update-username", json={"new_username": "a"})
        assert r.status_code == 422

    def test_username_available_endpoint(self, client, seed_users):
        r = client.get("/user/check-username?username=newname")
        assert r.json()["available"] is True

    def test_username_unavailable_endpoint(self, client, seed_users):
        r = client.get("/user/check-username?username=alice")
        assert r.json()["available"] is False


class TestUserUpdateAvatar:
    def test_update_valid_avatar(self, client, seed_users):
        r = client.put("/user/update-avatar", json={"avatar_key": "blue"})
        assert r.status_code == 200

    def test_update_invalid_avatar(self, client, seed_users):
        r = client.put("/user/update-avatar", json={"avatar_key": "neon_green"})
        assert r.status_code == 422

    def test_clear_avatar(self, client, seed_users):
        r = client.put("/user/update-avatar", json={"avatar_key": None})
        assert r.status_code == 200


class TestUserUpdateBio:
    def test_update_bio(self, client, seed_users):
        r = client.put("/user/update-bio", json={"bio": "Hello world"})
        assert r.status_code == 200
        assert r.json()["bio"] == "Hello world"

    def test_bio_too_long_rejected(self, client, seed_users):
        r = client.put("/user/update-bio", json={"bio": "x" * 301})
        assert r.status_code == 422

    def test_clear_bio(self, client, seed_users):
        r = client.put("/user/update-bio", json={"bio": None})
        assert r.status_code == 200


class TestPublicProfile:
    def test_profile_not_found(self, client, seed_users):
        r = client.get("/user/profile/nobody")
        assert r.status_code == 404

    def test_own_profile_returns_400(self, client, seed_users):
        r = client.get("/user/profile/alice")
        assert r.status_code == 400

    def test_private_profile_hides_lists(self, db):
        from app.models.user import User

        db.add(
            User(id="test-uid-1", username="alice", profile_visibility="friends_only")
        )
        db.add(User(id="test-uid-2", username="bob", profile_visibility="friends_only"))
        db.commit()
        c1 = make_client("test-uid-1")
        r = c1.get("/user/profile/bob")
        assert r.status_code == 200
        data = r.json()
        assert "watchlist" not in data
        assert "watched" not in data

    def test_public_profile_shows_lists(self, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob", profile_visibility="public"))
        db.commit()
        c1 = make_client("test-uid-1")
        r = c1.get("/user/profile/bob")
        data = r.json()
        assert "watchlist" in data or "watched" in data

    def test_friends_can_see_private_profile(self, db):
        from app.models.user import User
        from app.models.friendship import Friendship

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob", profile_visibility="friends_only"))
        db.flush()
        db.add(
            Friendship(
                requester_id="test-uid-1", addressee_id="test-uid-2", status="accepted"
            )
        )
        db.commit()
        c1 = make_client("test-uid-1")
        r = c1.get("/user/profile/bob")
        data = r.json()
        assert "watchlist" in data


@pytest.mark.skip(
    reason="requires PostgreSQL: dialect-specific SQL (AT TIME ZONE / ::cast)"
)
class TestProfileSummary:
    def test_profile_summary_shape(self, client, seed_users):
        r = client.get("/user/profile-summary")
        assert r.status_code == 200
        data = r.json()
        assert "user" in data
        assert "favorites" in data
        assert "watchlist" in data
        assert "watched" in data
        assert "friends" in data
        assert "incoming_requests" in data
        assert "outgoing_requests" in data
        assert "followers" in data

    def test_profile_summary_watchlist_has_counts(self, client, seed_users):
        r = client.get("/user/profile-summary")
        data = r.json()
        assert "total_movies" in data["watchlist"]
        assert "total_shows" in data["watchlist"]
        assert "total_movies" in data["watched"]
        assert "total_shows" in data["watched"]

    def test_profile_summary_counts_reflect_data(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.watchlist import Watchlist
        from datetime import datetime

        db.add(
            Watchlist(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                added_at=datetime.utcnow(),
            )
        )
        db.commit()
        r = client.get("/user/profile-summary")
        data = r.json()
        assert data["watchlist"]["total_movies"] == 1
        assert len(data["watchlist"]["movies"]) == 1

    def test_profile_summary_preview_capped_at_five(self, client, db, seed_users):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from datetime import datetime

        for i in range(1, 8):
            db.add(Movie(id=i, title=f"Movie {i}", tracking_count=1))
        db.flush()
        for i in range(1, 8):
            db.add(
                Watchlist(
                    user_id="test-uid-1",
                    content_type="movie",
                    content_id=i,
                    added_at=datetime.utcnow(),
                )
            )
        db.commit()
        r = client.get("/user/profile-summary")
        data = r.json()
        assert data["watchlist"]["total_movies"] == 7
        assert len(data["watchlist"]["movies"]) == 5

    def test_profile_summary_requires_auth(self):
        from fastapi.testclient import TestClient
        from app.main import app

        c = TestClient(app, raise_server_exceptions=False)
        r = c.get("/user/profile-summary")
        assert r.status_code in (400, 401, 403, 422)


class TestAccountDelete:
    def test_delete_account(self, client, seed_users):
        r = client.delete("/user/account")
        assert r.status_code == 200

    def test_delete_removes_user_row(self, client, db, seed_users):
        from app.models.user import User

        client.delete("/user/account")
        db.expire_all()
        u = db.query(User).filter_by(id="test-uid-1").first()
        assert u is None

    def test_delete_clears_watchlist(self, client, db, seed_movie, seed_users):
        from app.models.watchlist import Watchlist
        from datetime import datetime

        db.add(
            Watchlist(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                added_at=datetime.utcnow(),
            )
        )
        db.commit()
        client.delete("/user/account")
        db.expire_all()
        rows = db.query(Watchlist).filter_by(user_id="test-uid-1").all()
        assert rows == []

    def test_delete_clears_episode_watched(self, client, db, seed_show, seed_users):
        from app.models.episode_watched import EpisodeWatched

        db.add(
            EpisodeWatched(
                user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1
            )
        )
        db.commit()
        client.delete("/user/account")
        db.expire_all()
        rows = db.query(EpisodeWatched).filter_by(user_id="test-uid-1").all()
        assert rows == []

    def test_delete_does_not_remove_content_tracked_by_others(self, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from datetime import datetime

        db.query(Movie).filter_by(id=550).update({"tracking_count": 2})
        db.add(
            Watchlist(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                added_at=datetime.utcnow(),
            )
        )
        db.add(
            Watchlist(
                user_id="test-uid-2",
                content_type="movie",
                content_id=550,
                added_at=datetime.utcnow(),
            )
        )
        db.commit()
        c1 = make_client("test-uid-1")
        c1.delete("/user/account")
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m is not None
        assert m.tracking_count == 1
