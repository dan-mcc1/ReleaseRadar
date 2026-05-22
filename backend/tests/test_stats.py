"""
Tests for GET /user/stats.

_compute_streak uses PostgreSQL-specific SQL (AT TIME ZONE, LAG window function)
that does not run on SQLite.  All tests patch it out so the rest of the ORM
queries can be validated against the in-memory test database.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest

_ZERO_STREAK = {"current": 0, "longest": 0, "today_logged": False}
_ONE_STREAK = {"current": 1, "longest": 1, "today_logged": True}


@pytest.fixture(autouse=True)
def clear_stats_cache():
    """stats_service keeps a module-level TTL cache.  Clear it before and after
    every test so stale results from one test don't leak into the next."""
    from app.services.stats_service import _stats_cache
    _stats_cache.clear()
    yield
    _stats_cache.clear()


def _seed_user(db, uid="test-uid-1", username="alice"):
    from app.models.user import User

    db.add(User(id=uid, username=username, email=f"{username}@test.com"))
    db.commit()


def _add_watched(db, uid, content_type, content_id, rating=None):
    from app.models.watched import Watched

    db.add(
        Watched(
            user_id=uid,
            content_type=content_type,
            content_id=content_id,
            rating=rating,
            watched_at=datetime.now(timezone.utc),
        )
    )
    db.commit()


def _add_watchlist(db, uid, content_type, content_id):
    from app.models.watchlist import Watchlist

    db.add(Watchlist(user_id=uid, content_type=content_type, content_id=content_id))
    db.commit()


class TestStatsEmpty:
    def test_empty_counts(self, client, db):
        _seed_user(db)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.status_code == 200
        counts = r.json()["counts"]
        assert counts["movies_watched"] == 0
        assert counts["shows_watched"] == 0
        assert counts["episodes_watched"] == 0
        assert counts["movies_watchlist"] == 0
        assert counts["shows_watchlist"] == 0

    def test_empty_ratings(self, client, db):
        _seed_user(db)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        ratings = r.json()["ratings"]
        assert ratings["movie_avg"] is None
        assert ratings["show_avg"] is None
        assert len(ratings["distribution"]) == 5
        assert all(b["count"] == 0 for b in ratings["distribution"])

    def test_empty_genres(self, client, db):
        _seed_user(db)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["top_genres"] == []

    def test_streak_returned(self, client, db):
        _seed_user(db)
        with patch("app.services.stats_service._compute_streak", return_value=_ONE_STREAK):
            r = client.get("/user/stats")
        streak = r.json()["streak"]
        assert streak["current"] == 1
        assert streak["longest"] == 1
        assert streak["today_logged"] is True


class TestStatsCounts:
    def test_movies_watched_count(self, client, db, seed_movie):
        _seed_user(db)
        _add_watched(db, "test-uid-1", "movie", 550)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["counts"]["movies_watched"] == 1

    def test_shows_watched_count(self, client, db, seed_show):
        _seed_user(db)
        _add_watched(db, "test-uid-1", "tv", 1396)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["counts"]["shows_watched"] == 1

    def test_movies_watchlist_count(self, client, db, seed_movie):
        _seed_user(db)
        _add_watchlist(db, "test-uid-1", "movie", 550)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["counts"]["movies_watchlist"] == 1

    def test_shows_watchlist_count(self, client, db, seed_show):
        _seed_user(db)
        _add_watchlist(db, "test-uid-1", "tv", 1396)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["counts"]["shows_watchlist"] == 1

    def test_episodes_watched_count(self, client, db, seed_show):
        _seed_user(db)
        from app.models.episode_watched import EpisodeWatched

        db.add(EpisodeWatched(user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1))
        db.add(EpisodeWatched(user_id="test-uid-1", show_id=1396, season_number=1, episode_number=2))
        db.commit()
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["counts"]["episodes_watched"] == 2

    def test_counts_isolated_per_user(self, client, db, seed_movie):
        from tests.conftest import make_client

        _seed_user(db, "test-uid-1", "alice")
        _seed_user(db, "test-uid-2", "bob")
        _add_watched(db, "test-uid-2", "movie", 550)  # only bob watches
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")  # alice's stats
        assert r.json()["counts"]["movies_watched"] == 0


class TestStatsRatings:
    def test_movie_avg_rating(self, client, db, seed_movie):
        _seed_user(db)
        _add_watched(db, "test-uid-1", "movie", 550, rating=4.0)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["ratings"]["movie_avg"] == 4.0

    def test_show_avg_rating(self, client, db, seed_show):
        _seed_user(db)
        _add_watched(db, "test-uid-1", "tv", 1396, rating=3.5)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["ratings"]["show_avg"] == 3.5

    def test_rating_distribution_buckets(self, client, db):
        _seed_user(db)
        from app.models.watched import Watched

        # Use distinct content_ids — watched has a unique constraint on (user_id, type, id)
        for i, rating in enumerate([1.0, 2.0, 3.0, 4.0, 5.0], start=1):
            db.add(
                Watched(
                    user_id="test-uid-1",
                    content_type="movie",
                    content_id=1000 + i,
                    rating=rating,
                    watched_at=datetime.now(timezone.utc),
                )
            )
        db.commit()
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        dist = r.json()["ratings"]["distribution"]
        assert len(dist) == 5
        assert all(b["count"] == 1 for b in dist)

    def test_unrated_excluded_from_avg(self, client, db, seed_movie):
        _seed_user(db)
        _add_watched(db, "test-uid-1", "movie", 550, rating=None)
        with patch("app.services.stats_service._compute_streak", return_value=_ZERO_STREAK):
            r = client.get("/user/stats")
        assert r.json()["ratings"]["movie_avg"] is None


class TestStatsCacheInvalidation:
    def test_invalidate_removes_entry(self):
        from app.services.stats_service import invalidate_stats_cache, _stats_cache
        import time

        _stats_cache["test-uid-1"] = (time.monotonic(), {"cached": True})
        invalidate_stats_cache("test-uid-1")
        assert "test-uid-1" not in _stats_cache

    def test_invalidate_missing_key_is_noop(self):
        from app.services.stats_service import invalidate_stats_cache

        invalidate_stats_cache("nonexistent-uid")  # should not raise
