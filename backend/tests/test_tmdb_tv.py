"""Tests for app.services.tmdb_tv — TMDb TV wrappers with TTL caches."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_ttl_caches():
    """Reset all TTLCaches used as decorator state between tests."""
    from app.services import tmdb_tv
    for name in dir(tmdb_tv):
        obj = getattr(tmdb_tv, name)
        cache = getattr(obj, "cache", None)
        if cache is not None and hasattr(cache, "clear"):
            cache.clear()
    yield


class TestGetShow:
    def test_no_append(self):
        from app.services.tmdb_tv import get_show
        with patch("app.services.tmdb_tv.get", return_value={"id": 1}) as m:
            get_show(1)
        m.assert_called_once_with("/tv/1", params={})

    def test_with_append(self):
        from app.services.tmdb_tv import get_show
        with patch("app.services.tmdb_tv.get", return_value={"id": 1}) as m:
            get_show(2, append=("videos", "credits"))
        assert m.call_args.kwargs["params"] == {
            "append_to_response": "videos,credits"
        }


class TestGetPopularShows:
    def test_truncates_to_limit(self):
        from app.services.tmdb_tv import get_popular_shows
        data = {"results": [{"id": i} for i in range(20)]}
        with patch("app.services.tmdb_tv.get", return_value=data):
            result = get_popular_shows(limit=5)
        assert len(result) == 5


class TestGetTrendingShows:
    def test_week_window(self):
        from app.services.tmdb_tv import get_trending_shows
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": [{"id": 1}]}
        ) as m:
            assert get_trending_shows() == [{"id": 1}]
        m.assert_called_once_with("/trending/tv/week")

    def test_day_window(self):
        from app.services.tmdb_tv import get_trending_shows
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ) as m:
            get_trending_shows(time_window="day")
        m.assert_called_once_with("/trending/tv/day")


class TestGetShowsAiringToday:
    def test_calls_correct_endpoint(self):
        from app.services.tmdb_tv import get_shows_airing_today
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": [{"id": 1}]}
        ) as m:
            assert get_shows_airing_today() == [{"id": 1}]
        m.assert_called_once_with("/tv/airing_today", params={"region": "US"})


class TestGetUpcomingShows:
    def test_builds_date_range(self):
        from app.services.tmdb_tv import get_upcoming_shows
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ) as m:
            get_upcoming_shows(days=3)
        params = m.call_args.kwargs["params"]
        today = date.today()
        assert params["air_date.gte"] == today.isoformat()
        assert params["air_date.lte"] == (today + timedelta(days=3)).isoformat()
        assert params["sort_by"] == "popularity.desc"
        assert params["with_origin_country"] == "US"


class TestGetActivePopularShows:
    def test_non_december_month(self):
        from app.services.tmdb_tv import get_active_popular_shows
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ) as m:
            get_active_popular_shows(6, 2024)
        params = m.call_args.kwargs["params"]
        assert params["air_date.gte"] == "2024-06-01"
        assert params["air_date.lte"] == "2024-06-30"

    def test_december_month_uses_dec_31(self):
        from app.services.tmdb_tv import get_active_popular_shows
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ) as m:
            get_active_popular_shows(12, 2024)
        params = m.call_args.kwargs["params"]
        assert params["air_date.gte"] == "2024-12-01"
        assert params["air_date.lte"] == "2024-12-31"


class TestSearchTv:
    def test_query_uses_search_endpoint(self):
        from app.services.tmdb_tv import search_tv
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": [{"id": 7}]}
        ) as m:
            assert search_tv("foo") == [{"id": 7}]
        m.assert_called_once_with("/search/tv", params={"query": "foo"})

    def test_empty_query_uses_discover(self):
        from app.services.tmdb_tv import search_tv
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ) as m:
            assert search_tv("") == []
        m.assert_called_once_with("/discover/tv")


class TestGetShowsByActor:
    def test_no_match(self):
        from app.services.tmdb_tv import get_shows_by_actor
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": []}
        ):
            assert get_shows_by_actor("nobody") == []

    def test_returns_tv_cast(self):
        from app.services.tmdb_tv import get_shows_by_actor
        responses = [
            {"results": [{"id": 99}]},
            {"cast": [{"id": 12, "name": "S"}]},
        ]
        with patch(
            "app.services.tmdb_tv.get", side_effect=responses
        ) as m:
            assert get_shows_by_actor("bryan cranston") == [
                {"id": 12, "name": "S"}
            ]
        assert m.call_args_list[1][0][0] == "/person/99/tv_credits"


class TestGetShowRecommendations:
    def test_returns_results(self):
        from app.services.tmdb_tv import get_show_recommendations
        with patch(
            "app.services.tmdb_tv.get", return_value={"results": [{"id": 3}]}
        ) as m:
            assert get_show_recommendations(7) == [{"id": 3}]
        m.assert_called_once_with("/tv/7/recommendations")


class TestGetShowExternalIds:
    def test_returns_payload(self):
        from app.services.tmdb_tv import get_show_external_ids
        with patch(
            "app.services.tmdb_tv.get",
            return_value={"imdb_id": "tt0", "tvdb_id": 1},
        ) as m:
            assert get_show_external_ids(7) == {"imdb_id": "tt0", "tvdb_id": 1}
        m.assert_called_once_with("/tv/7/external_ids")


class TestGetShowNetworks:
    def test_returns_networks(self):
        from app.services.tmdb_tv import get_show_networks
        with patch(
            "app.services.tmdb_tv.get",
            return_value={"networks": [{"id": 1, "name": "HBO"}]},
        ):
            assert get_show_networks(5) == [{"id": 1, "name": "HBO"}]

    def test_missing_networks_returns_empty(self):
        from app.services.tmdb_tv import get_show_networks
        with patch("app.services.tmdb_tv.get", return_value={}):
            assert get_show_networks(5) == []


class TestGetShowFullCalendar:
    def test_skips_specials_and_no_aired_episodes(self):
        from app.services.tmdb_tv import get_show_full_calendar

        def fake_get(path, params=None):
            if path == "/tv/1":
                return {
                    "id": 1,
                    "seasons": [
                        {"season_number": 0},  # specials skipped
                        {"season_number": 1},
                        {"season_number": 2},
                    ],
                }
            if path == "/tv/1/season/1":
                return {"episodes": [
                    {"air_date": "2024-01-01", "id": 100},
                    {"air_date": None, "id": 101},  # skipped
                ]}
            if path == "/tv/1/season/2":
                return {"episodes": [{"air_date": "2024-02-01", "id": 200}]}
            return {}

        with patch("app.services.tmdb_tv.get", side_effect=fake_get):
            result = get_show_full_calendar(1)
        assert result["show_details"]["id"] == 1
        assert len(result["episodes"]) == 2
        assert {e["id"] for e in result["episodes"]} == {100, 200}


class TestGetShowSeasonCalendar:
    def test_no_non_special_seasons(self):
        from app.services.tmdb_tv import get_show_season_calendar
        with patch(
            "app.services.tmdb_tv.get",
            return_value={"id": 1, "seasons": [{"season_number": 0}]},
        ):
            result = get_show_season_calendar(1)
        assert result["episodes"] == []
        assert result["show_details"]["id"] == 1

    def test_picks_latest_season(self):
        from app.services.tmdb_tv import get_show_season_calendar

        def fake_get(path, params=None):
            if path == "/tv/9":
                return {
                    "id": 9,
                    "seasons": [
                        {"season_number": 1},
                        {"season_number": 3},
                        {"season_number": 2},
                    ],
                }
            if path == "/tv/9/season/3":
                return {"episodes": [
                    {"air_date": "2024-05-05", "id": 1},
                    {"air_date": None, "id": 2},
                ]}
            return {}

        with patch("app.services.tmdb_tv.get", side_effect=fake_get) as m:
            result = get_show_season_calendar(9)
        # season 3 fetched
        called_paths = [c.args[0] for c in m.call_args_list]
        assert "/tv/9/season/3" in called_paths
        assert len(result["episodes"]) == 1
        assert result["episodes"][0]["id"] == 1


class TestFetchShowFromTmdb:
    def test_without_append(self):
        from app.services.tmdb_tv import fetch_show_from_tmdb
        with patch(
            "app.services.tmdb_tv.get", return_value={"id": 5}
        ) as m:
            fetch_show_from_tmdb(5, None)
        m.assert_called_once_with("/tv/5", params={})

    def test_with_append(self):
        from app.services.tmdb_tv import fetch_show_from_tmdb
        with patch(
            "app.services.tmdb_tv.get", return_value={"id": 5}
        ) as m:
            fetch_show_from_tmdb(5, "videos,credits")
        assert m.call_args.kwargs["params"] == {
            "append_to_response": "videos,credits"
        }


class TestFetchSeasonDataFromTmdb:
    def test_filters_episodes_without_air_date(self):
        from app.services.tmdb_tv import fetch_season_data_from_tmdb
        data = {"episodes": [
            {"id": 1, "air_date": "2024-01-01"},
            {"id": 2, "air_date": None},
            {"id": 3, "air_date": "2024-02-01"},
        ]}
        with patch("app.services.tmdb_tv.get", return_value=data):
            result = fetch_season_data_from_tmdb(1, 1)
        assert [e["id"] for e in result] == [1, 3]


class TestGetFullSeasonInfo:
    def test_passes_through(self):
        from app.services.tmdb_tv import get_full_season_info
        with patch(
            "app.services.tmdb_tv.get", return_value={"id": 99}
        ) as m:
            assert get_full_season_info(1, 2) == {"id": 99}
        m.assert_called_once_with("/tv/1/season/2")
