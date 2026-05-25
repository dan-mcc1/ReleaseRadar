"""
Tests for app.services.for_you_service.

The service has three layers:
- _get_seeds_recent / _get_seeds_top_rated  → SQLite-safe DB seed queries
- _get_excluded                              → SQLite-safe union of user rows
- _fetch_tmdb_recommendations                → external HTTP, must be mocked
- get_for_you_recommendations                → end-to-end scoring/ranking

We mock the TMDb call so no network traffic happens. The internal TTL
cache is cleared between tests to avoid cross-test leakage.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _clear_rec_cache():
    """The module-level TTL cache leaks state across tests; flush it each time."""
    from app.services.for_you_service import _rec_cache, _rec_cache_lock
    with _rec_cache_lock:
        _rec_cache.clear()
    yield
    with _rec_cache_lock:
        _rec_cache.clear()


@pytest.fixture
def seed_user_with_history(db):
    from app.models.user import User
    from app.models.watched import Watched
    from app.models.watchlist import Watchlist
    from app.models.currently_watching import CurrentlyWatching

    db.add(User(id="uid1", username="uid1", email="u@test.com"))
    db.flush()
    now = datetime(2024, 5, 1, 12, 0, tzinfo=timezone.utc)
    # 2 movies watched, 1 watchlist, 1 currently watching
    db.add(Watched(user_id="uid1", content_type="movie", content_id=550,
                   rating=8.0, watched_at=now))
    db.add(Watched(user_id="uid1", content_type="movie", content_id=551,
                   rating=9.0, watched_at=now - timedelta(days=1)))
    db.add(Watched(user_id="uid1", content_type="tv", content_id=1396,
                   rating=None, watched_at=now - timedelta(days=2)))
    db.add(Watchlist(user_id="uid1", content_type="movie", content_id=600,
                     added_at=now))
    db.add(CurrentlyWatching(user_id="uid1", content_type="tv", content_id=700,
                             added_at=now))
    db.commit()


# ── Seed selection ─────────────────────────────────────────────────────────


class TestGetSeedsRecent:
    def test_returns_empty_for_unknown_user(self, db):
        from app.services.for_you_service import _get_seeds_recent
        assert _get_seeds_recent(db, "no-such-user") == []

    def test_combines_watched_and_watchlist(self, db, seed_user_with_history):
        from app.services.for_you_service import _get_seeds_recent
        seeds = _get_seeds_recent(db, "uid1")
        # 3 watched + 1 watchlist = 4 unique seeds
        assert len(seeds) == 4
        assert ("movie", 550) in seeds
        assert ("movie", 600) in seeds
        assert ("tv", 1396) in seeds

    def test_dedupes_overlap(self, db):
        """Same (ct, cid) in both lists should appear once."""
        from app.models.user import User
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist
        from app.services.for_you_service import _get_seeds_recent

        db.add(User(id="dup", username="dup", email="d@test.com"))
        db.flush()
        now = datetime.now(timezone.utc)
        db.add(Watched(user_id="dup", content_type="movie", content_id=42,
                       watched_at=now))
        db.add(Watchlist(user_id="dup", content_type="movie", content_id=42,
                         added_at=now))
        db.commit()

        seeds = _get_seeds_recent(db, "dup")
        assert seeds == [("movie", 42)]


class TestGetSeedsTopRated:
    def test_returns_empty_when_no_ratings(self, db):
        from app.models.user import User
        from app.models.watched import Watched
        from app.services.for_you_service import _get_seeds_top_rated

        db.add(User(id="u", username="u", email="u@t.com"))
        db.flush()
        # Has watched but rating is None — should be excluded
        db.add(Watched(user_id="u", content_type="movie", content_id=1,
                       rating=None, watched_at=datetime.now(timezone.utc)))
        db.commit()
        assert _get_seeds_top_rated(db, "u") == []

    def test_orders_by_rating_desc(self, db, seed_user_with_history):
        from app.services.for_you_service import _get_seeds_top_rated
        seeds = _get_seeds_top_rated(db, "uid1")
        # Only 550 + 551 have ratings; 551 (9.0) before 550 (8.0)
        assert seeds == [("movie", 551), ("movie", 550)]


class TestGetExcluded:
    def test_includes_all_three_sources(self, db, seed_user_with_history):
        from app.services.for_you_service import _get_excluded
        excluded = _get_excluded(db, "uid1")
        # Watched (3) + watchlist (1) + currently (1) = 5 entries
        assert ("movie", 550) in excluded
        assert ("movie", 600) in excluded  # watchlist
        assert ("tv", 700) in excluded     # currently watching

    def test_empty_for_unknown_user(self, db):
        from app.services.for_you_service import _get_excluded
        assert _get_excluded(db, "no-user") == set()


# ── _fetch_tmdb_recommendations ────────────────────────────────────────────


class TestFetchTmdbRecommendations:
    def test_calls_movie_endpoint(self):
        from app.services.for_you_service import _fetch_tmdb_recommendations
        with patch("app.services.for_you_service.get",
                   return_value={"results": [{"id": 1, "title": "X"}]}) as mock_get:
            result = _fetch_tmdb_recommendations("movie", 100)
            assert result == [{"id": 1, "title": "X", "media_type": "movie"}]
            mock_get.assert_called_once()
            assert "/movie/100/recommendations" in mock_get.call_args[0][0]

    def test_calls_tv_endpoint(self):
        from app.services.for_you_service import _fetch_tmdb_recommendations
        with patch("app.services.for_you_service.get",
                   return_value={"results": [{"id": 2, "name": "Y"}]}) as mock_get:
            result = _fetch_tmdb_recommendations("tv", 200)
            assert result == [{"id": 2, "name": "Y", "media_type": "tv"}]
            assert "/tv/200/recommendations" in mock_get.call_args[0][0]

    def test_caches_response(self):
        from app.services.for_you_service import _fetch_tmdb_recommendations
        with patch("app.services.for_you_service.get",
                   return_value={"results": [{"id": 1, "title": "X"}]}) as mock_get:
            _fetch_tmdb_recommendations("movie", 300)
            _fetch_tmdb_recommendations("movie", 300)
            assert mock_get.call_count == 1  # second call hit the cache

    def test_exception_returns_empty_list(self):
        from app.services.for_you_service import _fetch_tmdb_recommendations
        with patch("app.services.for_you_service.get",
                   side_effect=Exception("boom")):
            assert _fetch_tmdb_recommendations("movie", 400) == []


# ── get_for_you_recommendations ────────────────────────────────────────────


class TestGetForYouRecommendations:
    def test_no_seeds_returns_empty_lists(self, db):
        from app.services.for_you_service import get_for_you_recommendations
        result = get_for_you_recommendations(db, "no-user")
        assert result == {"movies": [], "shows": []}

    def test_combines_recs_from_multiple_seeds(self, db, seed_user_with_history):
        """Two seeds both recommend the same movie → it ranks high (frequency=2)."""
        from app.services.for_you_service import get_for_you_recommendations

        # Different return per seed; movie {id: 9001} appears in both → score boost
        def fake_get(path, params=None):
            if "/movie/550" in path:
                return {"results": [
                    {"id": 9001, "title": "Top", "popularity": 50},
                    {"id": 9002, "title": "Other", "popularity": 10},
                ]}
            if "/movie/551" in path:
                return {"results": [
                    {"id": 9001, "title": "Top", "popularity": 50},
                ]}
            return {"results": []}

        with patch("app.services.for_you_service.get", side_effect=fake_get):
            result = get_for_you_recommendations(db, "uid1", mode="top_rated")

        # Both seeds recommend 9001; it should be first
        assert result["movies"][0]["id"] == 9001
        assert result["seed_count"] == 2

    def test_excludes_already_tracked(self, db, seed_user_with_history):
        """A recommended item the user already has must not appear."""
        from app.services.for_you_service import get_for_you_recommendations

        # TMDb recommends id=550 (already in watched) and id=999 (new)
        def fake_get(path, params=None):
            return {"results": [
                {"id": 550, "title": "Already watched", "popularity": 100},
                {"id": 999, "title": "Fresh", "popularity": 20},
            ]}

        with patch("app.services.for_you_service.get", side_effect=fake_get):
            result = get_for_you_recommendations(db, "uid1", mode="recent")

        movie_ids = {m["id"] for m in result["movies"]}
        assert 550 not in movie_ids
        assert 999 in movie_ids

    def test_splits_movies_and_shows(self, db, seed_user_with_history):
        from app.services.for_you_service import get_for_you_recommendations

        def fake_get(path, params=None):
            return {"results": [
                {"id": 9001, "title": "M", "popularity": 1},        # movie
                {"id": 9002, "name": "S", "popularity": 1},          # tv
            ]}

        with patch("app.services.for_you_service.get", side_effect=fake_get):
            result = get_for_you_recommendations(db, "uid1")

        assert any(m["id"] == 9001 for m in result["movies"])
        assert any(s["id"] == 9002 for s in result["shows"])

    def test_top_rated_mode_uses_rated_seeds(self, db, seed_user_with_history):
        """top_rated mode should not include the unrated tv seed (1396)."""
        from app.services.for_you_service import get_for_you_recommendations
        seen_paths: list[str] = []

        def fake_get(path, params=None):
            seen_paths.append(path)
            return {"results": []}

        with patch("app.services.for_you_service.get", side_effect=fake_get):
            get_for_you_recommendations(db, "uid1", mode="top_rated")

        # Only the two rated movies should generate requests
        assert any("/movie/550" in p for p in seen_paths)
        assert any("/movie/551" in p for p in seen_paths)
        assert not any("/tv/1396" in p for p in seen_paths)

    def test_skips_items_with_missing_id(self, db, seed_user_with_history):
        from app.services.for_you_service import get_for_you_recommendations

        def fake_get(path, params=None):
            return {"results": [
                {"title": "no id", "popularity": 1},
                {"id": 12345, "title": "good", "popularity": 1},
            ]}

        with patch("app.services.for_you_service.get", side_effect=fake_get):
            result = get_for_you_recommendations(db, "uid1")
        ids = {m["id"] for m in result["movies"]}
        assert 12345 in ids


# ── PG-only paths ──────────────────────────────────────────────────────────


@pytest.mark.skip(reason="PG-only syntax — for_you currently has no PG-only paths; placeholder for future")
class TestForYouPgOnly:
    def test_placeholder(self):
        pass
