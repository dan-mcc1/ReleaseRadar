"""Tests for app.services.tmdb_movies — TMDb movie wrappers."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_caches():
    """Reset all @lru_cache between tests so call counts are deterministic."""
    from app.services import tmdb_movies
    for name in dir(tmdb_movies):
        obj = getattr(tmdb_movies, name)
        if hasattr(obj, "cache_clear"):
            obj.cache_clear()
    yield


class TestGetMovieInfo:
    def test_no_append(self):
        from app.services.tmdb_movies import get_movie_info
        with patch("app.services.tmdb_movies.get", return_value={"id": 1}) as m:
            assert get_movie_info(1) == {"id": 1}
        m.assert_called_once_with("/movie/1", params={})

    def test_with_append(self):
        from app.services.tmdb_movies import get_movie_info
        with patch("app.services.tmdb_movies.get", return_value={"id": 1}) as m:
            get_movie_info(1, append=("videos", "credits"))
        assert m.call_args.kwargs["params"] == {
            "append_to_response": "videos,credits"
        }

    def test_lru_cached(self):
        from app.services.tmdb_movies import get_movie_info
        with patch("app.services.tmdb_movies.get", return_value={"id": 1}) as m:
            get_movie_info(42)
            get_movie_info(42)
        assert m.call_count == 1


class TestGetPopularMovies:
    def test_default_limit(self):
        from app.services.tmdb_movies import get_popular_movies
        data = {"results": [{"id": i} for i in range(20)]}
        with patch("app.services.tmdb_movies.get", return_value=data) as m:
            result = get_popular_movies()
        assert len(result) == 10
        m.assert_called_once_with("/movie/popular", params={"region": "US"})

    def test_custom_region_and_limit(self):
        from app.services.tmdb_movies import get_popular_movies
        data = {"results": [{"id": i} for i in range(5)]}
        with patch("app.services.tmdb_movies.get", return_value=data) as m:
            result = get_popular_movies(region="GB", limit=3)
        assert len(result) == 3
        m.assert_called_once_with("/movie/popular", params={"region": "GB"})

    def test_missing_results_returns_empty(self):
        from app.services.tmdb_movies import get_popular_movies
        with patch("app.services.tmdb_movies.get", return_value={}):
            assert get_popular_movies() == []


class TestGetTrendingMovies:
    def test_default_window(self):
        from app.services.tmdb_movies import get_trending_movies
        with patch(
            "app.services.tmdb_movies.get", return_value={"results": [{"id": 1}]}
        ) as m:
            assert get_trending_movies() == [{"id": 1}]
        m.assert_called_once_with("/trending/movie/week")

    def test_day_window(self):
        from app.services.tmdb_movies import get_trending_movies
        with patch(
            "app.services.tmdb_movies.get", return_value={"results": []}
        ) as m:
            get_trending_movies(time_window="day")
        m.assert_called_once_with("/trending/movie/day")


class TestGetNowPlayingMovies:
    def test_calls_correct_endpoint(self):
        from app.services.tmdb_movies import get_now_playing_movies
        with patch(
            "app.services.tmdb_movies.get", return_value={"results": [{"id": 5}]}
        ) as m:
            assert get_now_playing_movies() == [{"id": 5}]
        m.assert_called_once_with("/movie/now_playing", params={"region": "US"})


class TestGetUpcomingMovies:
    def test_builds_date_range(self):
        from app.services.tmdb_movies import get_upcoming_movies
        with patch(
            "app.services.tmdb_movies.get", return_value={"results": [{"id": 9}]}
        ) as m:
            result = get_upcoming_movies(days=14)
        assert result == [{"id": 9}]
        kwargs = m.call_args.kwargs["params"]
        assert kwargs["sort_by"] == "popularity.desc"
        assert kwargs["region"] == "US"
        today = date.today()
        assert kwargs["primary_release_date.gte"] == today.isoformat()
        assert kwargs["primary_release_date.lte"] == (
            today + timedelta(days=14)
        ).isoformat()


class TestSearchMovies:
    def test_query_uses_search_endpoint(self):
        from app.services.tmdb_movies import search_movies
        with patch(
            "app.services.tmdb_movies.get",
            return_value={"results": [{"id": 7}]},
        ) as m:
            result = search_movies(query="dune")
        assert result == [{"id": 7}]
        m.assert_called_once_with("/search/movie", params={"query": "dune"})

    def test_genre_only_uses_discover(self):
        from app.services.tmdb_movies import search_movies
        with patch(
            "app.services.tmdb_movies.get",
            return_value={"results": [{"id": 11}]},
        ) as m:
            result = search_movies(genre="28")
        assert result == [{"id": 11}]
        m.assert_called_once_with("/discover/movie", params={"with_genres": "28"})

    def test_neither_uses_discover_no_params(self):
        from app.services.tmdb_movies import search_movies
        with patch(
            "app.services.tmdb_movies.get",
            return_value={"results": []},
        ) as m:
            assert search_movies() == []
        m.assert_called_once_with("/discover/movie", params={})


class TestGetMoviesByActor:
    def test_no_person_match_returns_empty(self):
        from app.services.tmdb_movies import get_movies_by_actor
        with patch(
            "app.services.tmdb_movies.get",
            return_value={"results": []},
        ) as m:
            assert get_movies_by_actor("nobody") == []
        m.assert_called_once_with("/search/person", params={"query": "nobody"})

    def test_returns_cast_credits(self):
        from app.services.tmdb_movies import get_movies_by_actor
        responses = [
            {"results": [{"id": 42}]},
            {"cast": [{"id": 1, "title": "Foo"}]},
        ]
        with patch(
            "app.services.tmdb_movies.get", side_effect=responses
        ) as m:
            assert get_movies_by_actor("brad pitt") == [
                {"id": 1, "title": "Foo"}
            ]
        # second call is for that person's movie_credits
        assert m.call_args_list[1][0][0] == "/person/42/movie_credits"


class TestFetchMovieFromTmdb:
    def test_without_append(self):
        from app.services.tmdb_movies import fetch_movie_from_tmdb
        with patch(
            "app.services.tmdb_movies.get", return_value={"id": 100}
        ) as m:
            fetch_movie_from_tmdb(100)
        m.assert_called_once_with("/movie/100", params={})

    def test_with_append(self):
        from app.services.tmdb_movies import fetch_movie_from_tmdb
        with patch(
            "app.services.tmdb_movies.get", return_value={"id": 100}
        ) as m:
            fetch_movie_from_tmdb(100, append="videos,credits")
        assert m.call_args.kwargs["params"] == {
            "append_to_response": "videos,credits"
        }
