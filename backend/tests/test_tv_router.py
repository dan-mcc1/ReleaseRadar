"""Tests for app.routers.tv — TMDb-passthrough endpoints with DB fast-path."""

from unittest.mock import patch

import pytest


class TestGetShowInfo:
    def test_returns_db_show_when_present(self, client, seed_show):
        r = client.get("/tv/1396")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == 1396
        assert body["name"] == "Breaking Bad"

    def test_falls_back_to_tmdb_when_missing(self, client):
        with patch(
            "app.routers.tv.fetch_show_from_tmdb",
            return_value={"id": 9999, "name": "Remote Show"},
        ) as m:
            r = client.get("/tv/9999")
        assert r.status_code == 200
        assert r.json() == {"id": 9999, "name": "Remote Show"}
        m.assert_called_once()

    def test_tmdb_404_returns_404(self, client):
        with patch("app.routers.tv.fetch_show_from_tmdb", return_value=None):
            r = client.get("/tv/9999")
        assert r.status_code == 404


class TestFullShowInfo:
    def test_returns_payload_with_db_overrides(self, client, seed_show):
        tmdb_data = {
            "id": 1396,
            "name": "Breaking Bad",
            "backdrop_path": "/from-tmdb-backdrop.jpg",
            "poster_path": "/from-tmdb-poster.jpg",
            "images": {"logos": []},
        }
        with patch(
            "app.routers.tv.fetch_show_from_tmdb", return_value=tmdb_data
        ):
            r = client.get("/tv/1396/full")
        assert r.status_code == 200

    def test_missing_show_returns_404(self, client):
        with patch("app.routers.tv.fetch_show_from_tmdb", return_value=None):
            r = client.get("/tv/1/full")
        assert r.status_code == 404

    def test_picks_english_logo_when_present(self, client):
        tmdb_data = {
            "id": 1,
            "name": "X",
            "images": {
                "logos": [
                    {"iso_639_1": "fr", "file_path": "/fr.png"},
                    {"iso_639_1": "en", "file_path": "/en.png"},
                ]
            },
        }
        with patch(
            "app.routers.tv.fetch_show_from_tmdb", return_value=tmdb_data
        ):
            r = client.get("/tv/1/full")
        assert r.json()["logo_path"] == "/en.png"


class TestSeasonCalendar:
    def test_db_show_returns_episodes(self, client, seed_show):
        r = client.get("/tv/1396/season_calendar")
        assert r.status_code == 200
        episodes = r.json()
        # seed_show has 2 episodes in season 1
        assert len(episodes) == 2
        assert episodes[0]["name"] == "Pilot"

    def test_missing_show_uses_tmdb(self, client):
        # No show in DB; fetch_show_from_tmdb supplies seasons,
        # fetch_season_data_from_tmdb supplies episodes.
        with patch(
            "app.routers.tv.fetch_show_from_tmdb",
            return_value={"id": 7, "seasons": [{"season_number": 1}]},
        ), patch(
            "app.routers.tv.fetch_season_data_from_tmdb",
            return_value=[{"id": 1, "name": "Ep1", "air_date": "2024-01-01"}],
        ):
            r = client.get("/tv/7/season_calendar")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_tmdb_404_returns_404(self, client):
        with patch("app.routers.tv.fetch_show_from_tmdb", return_value=None):
            r = client.get("/tv/9999/season_calendar")
        assert r.status_code == 404


class TestFullCalendar:
    def test_db_show_returns_all_season_calendars(self, client, seed_show):
        with patch(
            "app.routers.tv.fetch_season_data_from_tmdb",
            return_value=[{"id": 1}],
        ):
            r = client.get("/tv/1396/full_calendar")
        assert r.status_code == 200
        # Seeded show has one season → one calendar entry
        assert isinstance(r.json(), list)

    def test_tmdb_404_returns_404(self, client):
        with patch("app.routers.tv.fetch_show_from_tmdb", return_value=None):
            r = client.get("/tv/9999/full_calendar")
        assert r.status_code == 404


class TestEpisodeRatings:
    def test_returns_episodes_grouped_by_season(self, client, seed_show):
        r = client.get("/tv/1396/episode_ratings")
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["season_number"] == 1
        assert len(body[0]["episodes"]) == 2

    def test_unknown_show_returns_404(self, client):
        r = client.get("/tv/9999/episode_ratings")
        assert r.status_code == 404


class TestFullSeasonInfo:
    def test_passes_through_tmdb(self, client):
        with patch(
            "app.routers.tv.get_full_season_info",
            return_value={"id": 1, "name": "S1"},
        ) as m:
            r = client.get("/tv/1/season/1/info")
        assert r.status_code == 200
        assert r.json() == {"id": 1, "name": "S1"}
        m.assert_called_once_with(1, 1)


class TestEpisodeInfo:
    def test_returns_episode_with_show_id_injected(self, client):
        async def _fake_get(*args, **kwargs):
            return {"id": 99, "name": "Pilot"}

        with patch("app.routers.tv.async_get", side_effect=_fake_get):
            r = client.get("/tv/123/season/1/episode/1")
        assert r.status_code == 200
        body = r.json()
        assert body["show_id"] == 123
        assert body["id"] == 99

    def test_tmdb_exception_returns_404(self, client):
        async def _raise(*a, **kw):
            raise RuntimeError("nope")

        with patch("app.routers.tv.async_get", side_effect=_raise):
            r = client.get("/tv/1/season/1/episode/1")
        assert r.status_code == 404

    def test_tmdb_empty_returns_404(self, client):
        async def _empty(*a, **kw):
            return None

        with patch("app.routers.tv.async_get", side_effect=_empty):
            r = client.get("/tv/1/season/1/episode/1")
        assert r.status_code == 404
