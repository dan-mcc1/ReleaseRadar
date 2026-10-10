"""
In-process TMDb response caches.

They must be bounded (a full movie payload is ~0.5 MB in Python), expire
(trending lists and movie details change), never hand out an object a caller
can mutate for everyone else, and never be used by background work, which
needs today's data and must not fill the cache.
"""

import time
from unittest.mock import MagicMock, patch

import pytest

from app.services import omdb_service, tmdb_movies, tmdb_people, tmdb_search, tmdb_tv

_MODULES = (tmdb_movies, tmdb_people, tmdb_search, tmdb_tv, omdb_service)


@pytest.fixture(autouse=True)
def clear_caches():
    for module in _MODULES:
        for obj in vars(module).values():
            if hasattr(obj, "cache_clear"):
                obj.cache_clear()
    yield


def _omdb_response():
    res = MagicMock()
    res.is_success = True
    res.json.return_value = {"Response": "True", "Ratings": []}
    return res


class TestMovieFetchers:
    def test_fetch_movie_from_tmdb_always_calls_tmdb(self):
        """Adds, imports, collection ingest and the nightly refreshes use it."""
        with patch("app.services.tmdb_movies.get", return_value={"id": 550}) as get:
            tmdb_movies.fetch_movie_from_tmdb(550, "watch/providers")
            tmdb_movies.fetch_movie_from_tmdb(550, "watch/providers")
        assert get.call_count == 2

    def test_cached_fetch_hits_tmdb_once(self):
        with patch("app.services.tmdb_movies.get", return_value={"id": 550}) as get:
            first = tmdb_movies.fetch_movie_from_tmdb_cached(550, "credits")
            second = tmdb_movies.fetch_movie_from_tmdb_cached(550, "credits")
        assert get.call_count == 1
        assert first == second == {"id": 550}

    def test_cached_fetch_returns_independent_copies(self):
        payload = {"id": 550, "poster_path": "/tmdb.jpg", "images": {"logos": []}}
        with patch("app.services.tmdb_movies.get", return_value=payload):
            first = tmdb_movies.fetch_movie_from_tmdb_cached(550, "images")
            first["poster_path"] = "/mutated.jpg"
            first["images"]["logos"].append({"file_path": "/x.png"})
            second = tmdb_movies.fetch_movie_from_tmdb_cached(550, "images")
        assert second == {"id": 550, "poster_path": "/tmdb.jpg", "images": {"logos": []}}


# (cached function, args, what to patch, return value)
_EXPIRING = [
    pytest.param(tmdb_movies.get_trending_movies, ("week",),
                 "app.services.tmdb_movies.get", {"results": []}, id="movie trending"),
    pytest.param(tmdb_people.get_person, (1, "movie_credits"),
                 "app.services.tmdb_people.get", {"id": 1}, id="person"),
    pytest.param(tmdb_search.get_movie_trending_results, (1,),
                 "app.services.tmdb_search.get", {"results": []}, id="search trending"),
    pytest.param(tmdb_search.get_movie_search_results, ("dune",),
                 "app.services.tmdb_search.get", {"results": []}, id="movie search"),
    pytest.param(omdb_service.get_omdb_scores, ("tt0137523",),
                 "app.services.omdb_service.httpx.get", _omdb_response(), id="omdb"),
]


class TestCachesExpire:
    @pytest.mark.parametrize("fn,args,target,value", _EXPIRING)
    def test_refetched_after_a_day(self, fn, args, target, value):
        with patch(target, return_value=value) as upstream:
            fn(*args)
            fn(*args)
            assert upstream.call_count == 1
            fn.cache.expire(time.monotonic() + 86_401)
            fn(*args)
        assert upstream.call_count == 2


# (module, function to call, cached function holding the entries, args for id i)
_HEAVY = [
    pytest.param(tmdb_movies, "fetch_movie_from_tmdb_cached", "_fetch_movie_from_tmdb_cached",
                 lambda i: (i, "credits"), id="movie details"),
    pytest.param(tmdb_people, "get_person", "get_person",
                 lambda i: (i, "movie_credits"), id="person"),
    pytest.param(tmdb_tv, "fetch_show_from_tmdb_cached", "_fetch_show_from_tmdb_cached",
                 lambda i: (i, "credits"), id="show details"),
    pytest.param(tmdb_tv, "get_show", "get_show", lambda i: (i,), id="show"),
    pytest.param(tmdb_tv, "get_full_season_info", "get_full_season_info",
                 lambda i: (i, 1), id="season"),
    pytest.param(tmdb_tv, "fetch_season_data_from_tmdb", "fetch_season_data_from_tmdb",
                 lambda i: (i, 1), id="season episodes"),
]


class TestHeavyCachesAreBounded:
    @pytest.mark.parametrize("module,fn_name,holder_name,args", _HEAVY)
    def test_three_hundred_titles_do_not_all_stay_in_memory(self, module, fn_name, holder_name, args):
        fn = getattr(module, fn_name)
        with patch.object(module, "get", return_value={"id": 1, "episodes": []}):
            for i in range(300):
                fn(*args(i))
        assert len(getattr(module, holder_name).cache) < 300


class TestMovieInfoRoute:
    def test_db_artwork_overlay_does_not_leak_into_the_cache(self, client, db):
        from app.models.movie import Movie

        movie = Movie(id=42, title="X", tracking_count=0, poster_path="/db-poster.jpg")
        db.add(movie)
        db.commit()
        payload = {"id": 42, "title": "X", "poster_path": "/tmdb-poster.jpg", "images": {"logos": []}}

        with patch("app.services.tmdb_movies.get", return_value=payload):
            first = client.get("/movies/42/info").json()
            db.delete(movie)
            db.commit()
            second = client.get("/movies/42/info").json()

        assert first["poster_path"] == "/db-poster.jpg"
        assert second["poster_path"] == "/tmdb-poster.jpg"


class TestPersonInfoRoute:
    def test_sorting_credits_does_not_reorder_the_cached_payload(self, client):
        payload = {
            "id": 1,
            "movie_credits": {
                "cast": [{"id": 10, "popularity": 1.0}, {"id": 20, "popularity": 9.0}],
                "crew": [],
            },
            "tv_credits": {"cast": [], "crew": []},
        }
        with patch("app.services.tmdb_people.get", return_value=payload):
            body = client.get("/person/1/info").json()
            cached = tmdb_people.get_person(1, "external_ids,movie_credits,tv_credits")

        assert [c["id"] for c in body["movie_credits"]["cast"]] == [20, 10]
        assert [c["id"] for c in cached["movie_credits"]["cast"]] == [10, 20]
