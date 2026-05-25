"""
Tests for app.services.watch_time_service.

Covers the public get_watch_time_stats aggregation plus the _humor_fact helper.
Seeds the DB with mixed movie + episode watches, then asserts the totals,
genre/platform breakdowns, longest-binge, and available years come out right.

watch_time_service spins up its own SessionLocal in worker threads.
conftest.py patches app.db.session.SessionLocal so they hit the shared
in-memory test engine. Movies/episodes need real runtime values so the
sum aggregations are meaningful.
"""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest


@pytest.fixture
def seed_watch_history(db):
    """Build:
    - User 'u1' with 2 movies + 3 episodes watched
    - Movies have runtimes 120 + 90
    - Show has 3 episodes with runtimes 50, 60, 40 (all 3 watched)
    - Genres + Providers attached so breakdowns are populated
    """
    from app.models.user import User
    from app.models.movie import Movie
    from app.models.show import Show
    from app.models.episode import Episode
    from app.models.season import Season
    from app.models.watched import Watched
    from app.models.episode_watched import EpisodeWatched
    from app.models.genre import Genre, MovieGenre, ShowGenre
    from app.models.provider import Provider, MovieProvider, ShowProvider

    db.add(User(id="u1", username="u1", email="u1@test.com"))

    # Movies
    m1 = Movie(id=10, title="M1", status="Released", runtime=120, tracking_count=0)
    m2 = Movie(id=11, title="M2", status="Released", runtime=90, tracking_count=0)
    db.add_all([m1, m2])

    # Show + season + 3 episodes
    sh = Show(id=20, name="Sh", status="Ended", tracking_count=0,
              number_of_seasons=1, number_of_episodes=3)
    db.add(sh)
    db.flush()
    db.add(Season(id=2001, show_id=20, season_number=1, episode_count=3))
    eps = [
        Episode(id=21001, show_id=20, season_number=1, episode_number=1,
                name="E1", runtime=50),
        Episode(id=21002, show_id=20, season_number=1, episode_number=2,
                name="E2", runtime=60),
        Episode(id=21003, show_id=20, season_number=1, episode_number=3,
                name="E3", runtime=40),
    ]
    db.add_all(eps)

    # Genres
    g_action = Genre(id=28, name="Action")
    g_drama = Genre(id=18, name="Drama")
    db.add_all([g_action, g_drama])
    db.flush()
    db.add_all([
        MovieGenre(movie_id=10, genre_id=28),  # M1 = Action
        MovieGenre(movie_id=11, genre_id=18),  # M2 = Drama
        ShowGenre(show_id=20, genre_id=18),    # Show = Drama
    ])

    # Providers
    p_netflix = Provider(id=8, name="Netflix", logo_path="/nf.jpg")
    p_max = Provider(id=384, name="Max", logo_path="/max.jpg")
    db.add_all([p_netflix, p_max])
    db.flush()
    db.add_all([
        MovieProvider(movie_id=10, provider_id=8, flatrate=True),
        ShowProvider(show_id=20, provider_id=384, flatrate=True),
    ])

    # Watched (movies) — both in 2024
    now = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
    db.add(Watched(user_id="u1", content_type="movie", content_id=10,
                   watched_at=now))
    db.add(Watched(user_id="u1", content_type="movie", content_id=11,
                   watched_at=now))

    # EpisodeWatched — all 3 episodes on the same day in 2024
    db.add(EpisodeWatched(user_id="u1", show_id=20, episode_id=21001,
                          season_number=1, episode_number=1, watched_at=now))
    db.add(EpisodeWatched(user_id="u1", show_id=20, episode_id=21002,
                          season_number=1, episode_number=2, watched_at=now))
    db.add(EpisodeWatched(user_id="u1", show_id=20, episode_id=21003,
                          season_number=1, episode_number=3, watched_at=now))

    db.commit()


# ── _humor_fact pure helper ───────────────────────────────────────────────


class TestHumorFact:
    def test_zero_minutes_returns_a_fallback(self):
        from app.services.watch_time_service import _humor_fact
        # 0 minutes — no eligible fact, returns the "you could have watched N movies" fallback
        result = _humor_fact(0)
        assert "movies" in result or "watched" in result

    def test_small_minutes_uses_eligible_fact(self):
        """30 minutes is the smallest threshold ("complete HIIT workout")."""
        from app.services.watch_time_service import _humor_fact
        result = _humor_fact(30)
        assert "you could have" in result

    def test_large_minutes_uses_eligible_fact(self):
        from app.services.watch_time_service import _humor_fact
        # 5000 minutes definitely qualifies for several entries
        for _ in range(5):
            result = _humor_fact(5000)
            assert "you could have" in result

    def test_pluralization(self):
        from app.services.watch_time_service import _humor_fact
        # Run many trials to catch both singular + plural forms
        results = {_humor_fact(10000) for _ in range(50)}
        # At least one result should mention "times" or "time"
        assert any("time" in r for r in results)


# ── get_watch_time_stats aggregation ─────────────────────────────────────


class TestGetWatchTimeStats:
    def test_returns_zeros_for_user_with_no_history(self, db):
        from app.models.user import User
        from app.services.watch_time_service import get_watch_time_stats
        db.add(User(id="emptyu", username="empty", email="empty@test.com"))
        db.commit()

        stats = get_watch_time_stats(db, "emptyu")
        assert stats["total_minutes"] == 0
        assert stats["movie_minutes"] == 0
        assert stats["episode_minutes"] == 0
        assert stats["movies_count"] == 0
        assert stats["episodes_count"] == 0
        assert stats["top_genres"] == []
        assert stats["top_platforms"] == []
        assert stats["longest_binge"]["minutes"] == 0
        assert stats["longest_binge"]["date"] is None
        assert stats["humor_fact"] is None
        assert stats["available_years"] == []

    def test_aggregates_movie_and_episode_minutes(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        # 120 + 90 = 210 movie minutes; 50 + 60 + 40 = 150 episode minutes
        assert stats["movie_minutes"] == 210
        assert stats["episode_minutes"] == 150
        assert stats["total_minutes"] == 360
        assert stats["movies_count"] == 2
        assert stats["episodes_count"] == 3

    def test_year_filter_scopes_results(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        # All seed data is in 2024
        s2024 = get_watch_time_stats(db, "u1", year=2024)
        assert s2024["total_minutes"] == 360
        s2023 = get_watch_time_stats(db, "u1", year=2023)
        assert s2023["total_minutes"] == 0
        assert s2023["movies_count"] == 0
        assert s2023["episodes_count"] == 0

    def test_top_genres_combines_movie_and_show(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        by_name = {g["name"]: g["minutes"] for g in stats["top_genres"]}
        # Action came from M1 (one movie, runtime 120)
        assert "Action" in by_name
        assert by_name["Action"] >= 1
        # Drama came from M2 (90) + the show's 3 episodes (50+60+40=150)
        assert "Drama" in by_name
        assert by_name["Drama"] >= by_name["Action"]

    def test_top_platforms_combines_movie_and_show(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        by_name = {p["name"]: p for p in stats["top_platforms"]}
        assert "Netflix" in by_name
        assert "Max" in by_name
        assert by_name["Netflix"]["minutes"] > 0
        assert by_name["Max"]["minutes"] > 0

    def test_longest_binge_aggregates_per_day(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        binge = stats["longest_binge"]
        assert binge["minutes"] == 150  # all 3 episodes on the same day
        assert binge["date"] == "2024-06-15"

    def test_humor_fact_set_when_total_positive(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        assert stats["humor_fact"] is not None
        assert isinstance(stats["humor_fact"], str)

    def test_available_years(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1")
        assert 2024 in stats["available_years"]

    def test_other_user_data_excluded(self, db, seed_watch_history):
        """Watch counts must be scoped to the requested user only."""
        from app.models.user import User
        from app.models.watched import Watched
        from app.services.watch_time_service import get_watch_time_stats

        db.add(User(id="u2", username="u2", email="u2@test.com"))
        db.add(Watched(user_id="u2", content_type="movie", content_id=10,
                       watched_at=datetime(2024, 1, 1, tzinfo=timezone.utc)))
        db.commit()

        # u1's counts haven't changed
        stats = get_watch_time_stats(db, "u1")
        assert stats["movies_count"] == 2

    def test_returns_year_in_payload(self, db, seed_watch_history):
        from app.services.watch_time_service import get_watch_time_stats
        stats = get_watch_time_stats(db, "u1", year=2024)
        assert stats["year"] == 2024
        stats_all = get_watch_time_stats(db, "u1")
        assert stats_all["year"] is None
