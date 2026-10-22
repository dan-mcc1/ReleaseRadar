"""
Tests for the sync router (/sync).

  GET  /sync/token          → personal sync token (Firebase auth)
  POST /sync/token/revoke   → bump token version, return new token
  GET  /sync/export         → read-only watch state, Bearer sync-token auth
"""

from datetime import datetime, timezone

from app.config import settings
from tests.conftest import make_client


def _seed_user(db, uid="test-uid-1", **kw):
    from app.models.user import User

    kw.setdefault("subscription_tier", "admin")
    db.add(User(id=uid, username=uid, email=f"{uid}@test.com", **kw))
    db.commit()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _t(day):
    return datetime(2026, 1, day, 12, 0, tzinfo=timezone.utc)


class TestToken:
    def test_roundtrip(self, db, client):
        from app.routers.sync import _verify_token

        _seed_user(db)
        token = client.get("/sync/token").json()["token"]
        assert _verify_token(token, db).id == "test-uid-1"
        assert client.get("/sync/export", headers=_auth(token)).status_code == 200

    def test_revoke_invalidates_old_token(self, db, client):
        _seed_user(db)
        old = client.get("/sync/token").json()["token"]
        new = client.post("/sync/token/revoke").json()["token"]
        assert new != old
        assert client.get("/sync/export", headers=_auth(old)).status_code == 401
        assert client.get("/sync/export", headers=_auth(new)).status_code == 200

    def test_revoke_does_not_touch_ical_version(self, db, client):
        from app.models.user import User

        _seed_user(db)
        client.post("/sync/token/revoke")
        db.expire_all()
        assert db.get(User, "test-uid-1").ical_token_version == 1

    def test_ical_token_is_not_a_sync_token(self, db, client):
        from app.routers.ical import _make_token

        _seed_user(db, sync_token_version=1)
        assert client.get("/sync/export", headers=_auth(_make_token("test-uid-1", 1))).status_code == 401

    def test_missing_or_garbage_token_401(self, db, client):
        _seed_user(db)
        assert client.get("/sync/export").status_code == 401
        assert client.get("/sync/export", headers=_auth("garbage")).status_code == 401

    def test_query_string_token_not_accepted(self, db, client):
        _seed_user(db)
        token = client.get("/sync/token").json()["token"]
        assert client.get(f"/sync/export?token={token}").status_code == 401

    def test_missing_secret_503(self, db, client, monkeypatch):
        _seed_user(db)
        monkeypatch.setattr(settings, "SYNC_TOKEN_SECRET", "")
        assert client.get("/sync/token").status_code == 503
        assert client.post("/sync/token/revoke").status_code == 503
        assert client.get("/sync/export", headers=_auth("a.0.b")).status_code == 503

    def test_non_admin_cannot_get_or_revoke_token(self, db, client):
        _seed_user(db, subscription_tier="free")
        assert client.get("/sync/token").status_code == 403
        assert client.post("/sync/token/revoke").status_code == 403

    def test_token_stops_working_after_demotion(self, db, client):
        from app.models.user import User

        _seed_user(db)
        token = client.get("/sync/token").json()["token"]
        assert client.get("/sync/export", headers=_auth(token)).status_code == 200
        db.get(User, "test-uid-1").subscription_tier = "free"
        db.commit()
        r = client.get("/sync/export", headers=_auth(token))
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "admin_required"

    def test_token_stops_working_after_email_ban(self, db, client):
        from app.dependencies import auth
        from app.models.banned_email import BannedEmail

        _seed_user(db)
        token = client.get("/sync/token").json()["token"]
        db.add(BannedEmail(email="test-uid-1@test.com", user_id="test-uid-1"))
        db.commit()
        auth._banned_cache.clear()
        try:
            r = client.get("/sync/export", headers=_auth(token))
        finally:
            auth._banned_cache.clear()
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "account_banned"

    def test_banned_user_403(self, db, client):
        _seed_user(db, is_banned=True)
        token = client.get("/sync/token").json()["token"]
        r = client.get("/sync/export", headers=_auth(token))
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "account_banned"

    def test_failed_token_attempts_are_rate_limited(self, db, client, monkeypatch):
        from app.core import limiter as limiter_module

        monkeypatch.setattr(limiter_module.limiter, "enabled", True)
        monkeypatch.setattr(settings, "SYNC_AUTH_RATE_LIMIT", "2/minute")
        limiter_module._public_storage.reset()
        try:
            codes = [client.get("/sync/export", headers=_auth("a.0.b")).status_code for _ in range(3)]
        finally:
            limiter_module._public_storage.reset()
        assert codes == [401, 401, 429]

    def test_database_errors_are_not_reported_as_bad_tokens(self, db, client, monkeypatch):
        import pytest

        _seed_user(db)
        token = client.get("/sync/token").json()["token"]
        from app.routers.sync import _verify_token

        def broken_get(*args, **kwargs):
            raise RuntimeError("database down")

        monkeypatch.setattr(db, "get", broken_get)
        with pytest.raises(RuntimeError):
            _verify_token(token, db)


class TestExport:
    def test_shape_and_status_precedence(self, db, client):
        from app.models.currently_watching import CurrentlyWatching
        from app.models.episode_watched import EpisodeWatched
        from app.models.movie import Movie
        from app.models.rewatch import Rewatch
        from app.models.show import Show
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        _seed_user(db)
        db.add_all([
            Movie(id=1, title="Seen It", poster_path="/a.jpg"),
            Show(id=10, name="Mid Show", poster_path="/b.jpg"),
            # movie 1: all three lists -> watched
            Watched(user_id="test-uid-1", content_type="movie", content_id=1, watched_at=_t(5), rating=8.5),
            CurrentlyWatching(user_id="test-uid-1", content_type="movie", content_id=1, added_at=_t(3)),
            Watchlist(user_id="test-uid-1", content_type="movie", content_id=1, added_at=_t(2)),
            # show 10: watching + watchlist -> watching
            CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=10, added_at=_t(4)),
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=10, added_at=_t(1)),
            # movie 2: watchlist only, not cached
            Watchlist(user_id="test-uid-1", content_type="movie", content_id=2, added_at=_t(6)),
            EpisodeWatched(user_id="test-uid-1", show_id=10, season_number=1, episode_number=2,
                           watched_at=_t(7), rating=7.0),
            Rewatch(user_id="test-uid-1", content_type="movie", content_id=1, watched_at=_t(8), rating=9.0),
        ])
        db.commit()

        token = client.get("/sync/token").json()["token"]
        body = client.get("/sync/export", headers=_auth(token)).json()

        assert set(body) == {"generated_at", "movies", "shows", "episodes", "rewatches"}
        assert datetime.fromisoformat(body["generated_at"]).tzinfo is not None

        movies = {m["tmdb_id"]: m for m in body["movies"]}
        assert movies[1]["status"] == "watched"
        assert movies[1]["title"] == "Seen It"
        assert movies[1]["poster_url"] == "https://image.tmdb.org/t/p/w500/a.jpg"
        assert movies[1]["rating"] == 8.5
        assert movies[1]["watched_at"].startswith("2026-01-05T12:00:00")
        assert movies[1]["added_at"].startswith("2026-01-02T12:00:00")
        assert movies[2]["status"] == "watchlist"
        assert movies[2]["title"] is None and movies[2]["poster_url"] is None
        assert movies[2]["watched_at"] is None

        (show,) = body["shows"]
        assert show["tmdb_id"] == 10 and show["status"] == "watching"
        assert show["title"] == "Mid Show"

        assert body["episodes"] == [{
            "show_tmdb_id": 10, "season_number": 1, "episode_number": 2,
            "watched_at": body["episodes"][0]["watched_at"], "rating": 7.0,
        }]
        assert body["episodes"][0]["watched_at"].startswith("2026-01-07T12:00:00")
        assert body["rewatches"][0]["content_type"] == "movie"
        assert body["rewatches"][0]["tmdb_id"] == 1
        assert body["rewatches"][0]["rating"] == 9.0

    def test_other_users_data_excluded(self, db, client):
        from app.models.episode_watched import EpisodeWatched
        from app.models.rewatch import Rewatch
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        _seed_user(db)
        _seed_user(db, uid="other-uid")
        db.add_all([
            Watched(user_id="other-uid", content_type="movie", content_id=99, watched_at=_t(1)),
            Watchlist(user_id="other-uid", content_type="tv", content_id=98, added_at=_t(1)),
            EpisodeWatched(user_id="other-uid", show_id=98, season_number=1, episode_number=1, watched_at=_t(1)),
            Rewatch(user_id="other-uid", content_type="movie", content_id=99, watched_at=_t(1)),
        ])
        db.commit()

        token = client.get("/sync/token").json()["token"]
        body = client.get("/sync/export", headers=_auth(token)).json()
        assert body["movies"] == [] and body["shows"] == []
        assert body["episodes"] == [] and body["rewatches"] == []

    def test_constant_query_count(self, db, client, count_queries):
        from app.models.movie import Movie
        from app.models.watched import Watched

        _seed_user(db)
        for i in range(1, 11):
            db.add(Movie(id=i, title=f"M{i}"))
            db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=i, watched_at=_t(1)))
        db.commit()
        token = client.get("/sync/token").json()["token"]
        with count_queries() as q:
            client.get("/sync/export", headers=_auth(token))
        assert q.value <= 10
