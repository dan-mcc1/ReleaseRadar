"""Tests for app.services.tmdb_search — search/discover/trending wrappers."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_caches():
    from app.services import tmdb_search
    for name in dir(tmdb_search):
        obj = getattr(tmdb_search, name)
        if hasattr(obj, "cache_clear"):
            obj.cache_clear()
    yield


class TestSortedSearchHelpers:
    """Search result helpers all sort by popularity desc."""

    def test_collection_search_sorts_by_popularity(self):
        from app.services.tmdb_search import get_collection_search_results
        data = {"results": [
            {"id": 1, "popularity": 5.0},
            {"id": 2, "popularity": 100.0},
            {"id": 3, "popularity": 50.0},
        ]}
        with patch(
            "app.services.tmdb_search.get", return_value=data
        ) as m:
            result = get_collection_search_results("trek")
        assert [r["id"] for r in result] == [2, 3, 1]
        m.assert_called_once_with("/search/collection", params={"query": "trek"})

    def test_tv_search_sorts(self):
        from app.services.tmdb_search import get_tv_search_results
        data = {"results": [{"popularity": 1}, {"popularity": 9}]}
        with patch("app.services.tmdb_search.get", return_value=data):
            result = get_tv_search_results("a")
        assert [r["popularity"] for r in result] == [9, 1]

    def test_movie_search_sorts(self):
        from app.services.tmdb_search import get_movie_search_results
        data = {"results": [{"popularity": 0}, {}]}
        with patch("app.services.tmdb_search.get", return_value=data):
            result = get_movie_search_results("a")
        # missing popularity defaults to 0, so order: missing-or-zero stays
        assert len(result) == 2

    def test_person_search_sorts(self):
        from app.services.tmdb_search import get_person_search_results
        data = {"results": [{"popularity": 3}, {"popularity": 30}]}
        with patch("app.services.tmdb_search.get", return_value=data):
            result = get_person_search_results("a")
        assert result[0]["popularity"] == 30

    def test_empty_results_handled(self):
        from app.services.tmdb_search import get_movie_search_results
        with patch("app.services.tmdb_search.get", return_value={}):
            assert get_movie_search_results("zz") == []


class TestMultiSearch:
    def test_combines_three_searches(self):
        from app.services.tmdb_search import get_multi_search_results
        with patch(
            "app.services.tmdb_search.get_movie_search_results",
            return_value=["m"],
        ), patch(
            "app.services.tmdb_search.get_tv_search_results",
            return_value=["s"],
        ), patch(
            "app.services.tmdb_search.get_person_search_results",
            return_value=["p"],
        ):
            result = get_multi_search_results("query")
        assert result == {"movies": ["m"], "shows": ["s"], "people": ["p"]}


class TestGenreList:
    def test_combines_movie_and_tv_genres(self):
        from app.services.tmdb_search import get_genre_list
        responses = [
            {"genres": [{"id": 1, "name": "Action"}]},
            {"genres": [{"id": 2, "name": "Comedy"}]},
        ]
        with patch(
            "app.services.tmdb_search.get", side_effect=responses
        ) as m:
            result = get_genre_list()
        assert result == {
            "movie": [{"id": 1, "name": "Action"}],
            "tv": [{"id": 2, "name": "Comedy"}],
        }
        called_paths = [c.args[0] for c in m.call_args_list]
        assert "/genre/movie/list" in called_paths
        assert "/genre/tv/list" in called_paths


class TestByGenre:
    def test_tv_by_genre_caps_pages(self):
        from app.services.tmdb_search import get_tv_by_genre
        data = {"results": [{"id": 1}], "total_pages": 999}
        with patch(
            "app.services.tmdb_search.get", return_value=data
        ) as m:
            result = get_tv_by_genre(28, page=2)
        assert result["total_pages"] == 500
        assert m.call_args.kwargs["params"]["with_genres"] == 28
        assert m.call_args.kwargs["params"]["page"] == 2

    def test_movie_by_genre_returns_results(self):
        from app.services.tmdb_search import get_movie_by_genre
        data = {"results": [{"id": 1}], "total_pages": 5}
        with patch("app.services.tmdb_search.get", return_value=data):
            result = get_movie_by_genre(35)
        assert result["total_pages"] == 5
        assert result["results"] == [{"id": 1}]


class TestTrendingResults:
    def test_tv_trending_caps_pages(self):
        from app.services.tmdb_search import get_tv_trending_results
        data = {"results": [{"id": 1}], "total_pages": 600}
        with patch("app.services.tmdb_search.get", return_value=data):
            result = get_tv_trending_results()
        assert result["total_pages"] == 500

    def test_movie_trending_caps_pages(self):
        from app.services.tmdb_search import get_movie_trending_results
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 1000},
        ):
            assert get_movie_trending_results()["total_pages"] == 500

    def test_multi_trending_merges(self):
        from app.services.tmdb_search import get_multi_trending_results
        with patch(
            "app.services.tmdb_search.get_tv_trending_results",
            return_value={"results": ["s"]},
        ), patch(
            "app.services.tmdb_search.get_movie_trending_results",
            return_value={"results": ["m"]},
        ):
            assert get_multi_trending_results() == {
                "movies": ["m"],
                "shows": ["s"],
            }


class TestUpcoming:
    def test_movie_upcoming_passes_params(self):
        from app.services.tmdb_search import get_movie_upcoming
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 1},
        ) as m:
            get_movie_upcoming("2024-01-01", "2024-12-31", page=2)
        params = m.call_args.kwargs["params"]
        assert params["primary_release_date.gte"] == "2024-01-01"
        assert params["primary_release_date.lte"] == "2024-12-31"
        assert params["page"] == 2

    def test_tv_upcoming_passes_params(self):
        from app.services.tmdb_search import get_tv_upcoming
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 1},
        ) as m:
            get_tv_upcoming("2024-01-01", "2024-06-30")
        params = m.call_args.kwargs["params"]
        assert params["first_air_date.gte"] == "2024-01-01"
        assert params["first_air_date.lte"] == "2024-06-30"


class TestPopularAndTopRated:
    def test_tv_airing_today(self):
        from app.services.tmdb_search import get_tv_airing_today
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [{"id": 1}], "total_pages": 2},
        ) as m:
            result = get_tv_airing_today()
        assert result["results"] == [{"id": 1}]
        assert result["total_pages"] == 2
        m.assert_called_once_with(
            "/tv/airing_today", params={"language": "en-US", "page": 1}
        )

    def test_movie_now_playing(self):
        from app.services.tmdb_search import get_movie_now_playing
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 1},
        ) as m:
            get_movie_now_playing(page=3)
        m.assert_called_once_with(
            "/movie/now_playing", params={"language": "en-US", "page": 3}
        )

    def test_tv_popular(self):
        from app.services.tmdb_search import get_tv_popular
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": ["x"], "total_pages": 1},
        ):
            assert get_tv_popular()["results"] == ["x"]

    def test_movie_popular(self):
        from app.services.tmdb_search import get_movie_popular
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": ["x"], "total_pages": 1},
        ):
            assert get_movie_popular()["results"] == ["x"]

    def test_multi_popular(self):
        from app.services.tmdb_search import get_multi_popular_results
        with patch(
            "app.services.tmdb_search.get_tv_popular",
            return_value={"results": ["s"]},
        ), patch(
            "app.services.tmdb_search.get_movie_popular",
            return_value={"results": ["m"]},
        ):
            assert get_multi_popular_results() == {
                "movies": ["m"],
                "shows": ["s"],
            }

    def test_tv_top_rated(self):
        from app.services.tmdb_search import get_tv_top_rated
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 600},
        ):
            assert get_tv_top_rated()["total_pages"] == 500

    def test_movie_top_rated(self):
        from app.services.tmdb_search import get_movie_top_rated
        with patch(
            "app.services.tmdb_search.get",
            return_value={"results": [], "total_pages": 1},
        ):
            assert get_movie_top_rated()["total_pages"] == 1

    def test_multi_top_rated(self):
        from app.services.tmdb_search import get_multi_top_rated_results
        with patch(
            "app.services.tmdb_search.get_tv_top_rated",
            return_value={"results": ["s"]},
        ), patch(
            "app.services.tmdb_search.get_movie_top_rated",
            return_value={"results": ["m"]},
        ):
            assert get_multi_top_rated_results() == {
                "movies": ["m"],
                "shows": ["s"],
            }
