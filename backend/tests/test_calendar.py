"""Tests for the combined GET /calendar endpoint."""
import pytest
from datetime import date
from tests.conftest import make_client


# ── Helpers ──────────────────────────────────────────────────────────────────


def add_to_watchlist(client, content_type: str, content_id: int):
    return client.post(
        "/watchlist/add",
        json={"content_type": content_type, "content_id": content_id},
    )


def mark_episode_watched(client, show_id: int, season: int, episode: int):
    return client.post(
        f"/watched-episode/add?show_id={show_id}&season_number={season}&episode_number={episode}"
    )


def mark_movie_watched(client, movie_id: int):
    return client.post(
        "/watched/add",
        json={"content_type": "movie", "content_id": movie_id},
    )


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestCalendarEndpoint:
    def test_empty_calendar(self, client, seed_users):
        r = client.get("/calendar")
        assert r.status_code == 200
        data = r.json()
        assert data["shows"] == []
        assert data["movies"] == []

    def test_shows_include_episodes_in_range(self, client, seed_users, seed_show):
        add_to_watchlist(client, "tv", 1396)
        r = client.get("/calendar?from_date=2008-01-01&to_date=2008-01-31")
        assert r.status_code == 200
        data = r.json()
        assert len(data["shows"]) == 1
        show_entry = data["shows"][0]
        assert show_entry["show"]["id"] == 1396
        # Only episode 1 (Jan 20) is in range; episode 2 (Jan 27) is also in range
        episode_numbers = [e["episode_number"] for e in show_entry["episodes"]]
        assert 1 in episode_numbers
        assert 2 in episode_numbers

    def test_shows_excluded_when_no_episodes_in_range(self, client, seed_users, seed_show):
        add_to_watchlist(client, "tv", 1396)
        r = client.get("/calendar?from_date=2030-01-01&to_date=2030-01-31")
        assert r.status_code == 200
        assert r.json()["shows"] == []

    def test_episode_is_watched_false_by_default(self, client, seed_users, seed_show):
        add_to_watchlist(client, "tv", 1396)
        r = client.get("/calendar?from_date=2008-01-01&to_date=2008-01-31")
        episodes = r.json()["shows"][0]["episodes"]
        assert all(e["is_watched"] is False for e in episodes)

    def test_episode_is_watched_true_after_marking(self, client, seed_users, seed_show):
        add_to_watchlist(client, "tv", 1396)
        mark_episode_watched(client, 1396, 1, 1)
        r = client.get("/calendar?from_date=2008-01-01&to_date=2008-01-31")
        episodes = r.json()["shows"][0]["episodes"]
        ep1 = next(e for e in episodes if e["episode_number"] == 1)
        ep2 = next(e for e in episodes if e["episode_number"] == 2)
        assert ep1["is_watched"] is True
        assert ep2["is_watched"] is False

    def test_movies_included_with_is_watched(self, client, seed_users, seed_movie):
        add_to_watchlist(client, "movie", 550)
        r = client.get("/calendar")
        assert r.status_code == 200
        movies = r.json()["movies"]
        assert len(movies) == 1
        assert movies[0]["id"] == 550
        assert movies[0]["is_watched"] is False

    def test_movie_is_watched_true_after_marking(self, client, seed_users, seed_movie):
        add_to_watchlist(client, "movie", 550)
        mark_movie_watched(client, 550)
        r = client.get("/calendar")
        movies = r.json()["movies"]
        assert movies[0]["is_watched"] is True

    def test_no_date_params_returns_all_episodes(self, client, seed_users, seed_show):
        add_to_watchlist(client, "tv", 1396)
        r = client.get("/calendar")
        data = r.json()
        assert len(data["shows"]) == 1
        # Both episodes returned when no date filter
        assert len(data["shows"][0]["episodes"]) == 2

    def test_unauthenticated_returns_401(self):
        from fastapi.testclient import TestClient
        from app.main import app
        saved = app.dependency_overrides.copy()
        try:
            app.dependency_overrides.clear()
            plain_client = TestClient(app, base_url="http://localhost")
            r = plain_client.get("/calendar")
            assert r.status_code == 401
        finally:
            app.dependency_overrides = saved
