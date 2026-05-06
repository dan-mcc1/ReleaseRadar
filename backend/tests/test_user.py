"""
Tests for user endpoints: create, get, update username/email/avatar/bio,
profile visibility, account deletion, and tracking_count cleanup.
"""

import pytest
from tests.conftest import make_client


class TestUserCreate:
    def test_create_user(self, client):
        r = client.post("/user/create", json={"email": "alice@test.com", "username": "alice"})
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
        r = client.post("/user/create", json={"username": "ab", "email": "x@test.com"})  # too short
        assert r.status_code == 422

    def test_create_username_with_spaces_rejected(self, client):
        r = client.post("/user/create", json={"username": "bad name", "email": "x@test.com"})
        assert r.status_code == 422

    def test_create_idempotent(self, client):
        client.post("/user/create", json={"email": "alice@test.com", "username": "alice"})
        r = client.post("/user/create", json={"email": "alice@test.com", "username": "alice"})
        assert r.status_code in (200, 409)


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
        db.add(User(id="test-uid-1", username="alice", profile_visibility="friends_only"))
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
        db.add(Friendship(requester_id="test-uid-1", addressee_id="test-uid-2", status="accepted"))
        db.commit()
        c1 = make_client("test-uid-1")
        r = c1.get("/user/profile/bob")
        data = r.json()
        assert "watchlist" in data


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

    def test_profile_summary_counts_reflect_data(self, client, db, seed_users, seed_movie):
        from app.models.watchlist import Watchlist
        from datetime import datetime
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, added_at=datetime.utcnow()))
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
            db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=i, added_at=datetime.utcnow()))
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
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, added_at=datetime.utcnow()))
        db.commit()
        client.delete("/user/account")
        db.expire_all()
        rows = db.query(Watchlist).filter_by(user_id="test-uid-1").all()
        assert rows == []

    def test_delete_clears_episode_watched(self, client, db, seed_show, seed_users):
        from app.models.episode_watched import EpisodeWatched
        db.add(EpisodeWatched(user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1))
        db.commit()
        client.delete("/user/account")
        db.expire_all()
        rows = db.query(EpisodeWatched).filter_by(user_id="test-uid-1").all()
        assert rows == []

    def test_delete_decrements_tracking_count(self, client, db, seed_movie, seed_users):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from datetime import datetime
        # Seed movie already has tracking_count 0; add watchlist row
        db.query(Movie).filter_by(id=550).update({"tracking_count": 1})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, added_at=datetime.utcnow()))
        db.commit()
        client.delete("/user/account")
        db.expire_all()
        # tracking_count drops to 0 → movie deleted
        m = db.query(Movie).filter_by(id=550).first()
        assert m is None

    def test_delete_does_not_remove_content_tracked_by_others(self, db, seed_movie):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from datetime import datetime
        db.query(Movie).filter_by(id=550).update({"tracking_count": 2})
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, added_at=datetime.utcnow()))
        db.add(Watchlist(user_id="test-uid-2", content_type="movie", content_id=550, added_at=datetime.utcnow()))
        db.commit()
        c1 = make_client("test-uid-1")
        c1.delete("/user/account")
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m is not None
        assert m.tracking_count == 1
