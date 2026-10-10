"""
Cache-Control on public GET routes, so browsers, the iOS app and any CDN in
front of the API can serve repeat views without reaching Python.

A response that depends on who is asking must never be marked public: a
shared cache would hand one user's data to another.
"""

from unittest.mock import patch

import pytest
from fastapi.routing import APIRoute
from fastapi.security import HTTPBearer

from app.core.http_cache import public_cache_policy
from app.main import app

# Content routes that return the same thing for everyone.
PUBLIC_ROUTES = [
    "/tv/{id}",
    "/tv/{id}/full",
    "/tv/{id}/season_calendar",
    "/tv/{id}/episode_ratings",
    "/tv/{id}/season/{season_number}/info",
    "/tv/{id}/season/{season_number}/episode/{episode_number}",
    "/movies/{id}",
    "/movies/{id}/info",
    "/person/search",
    "/person/{id}",
    "/person/{id}/info",
    "/search",
    "/search/genres",
    "/search/multi/trending",
    "/search/tv/trending",
    "/search/movie/trending",
    "/search/tv/upcoming",
    "/search/movie/upcoming",
    "/search/tv/airing-today",
    "/search/movie/now-playing",
    "/search/multi/popular",
    "/search/multi/top-rated",
    "/box-office/yearly",
    "/box-office/monthly",
    "/box-office/all-time",
    "/collections/genres",
    "/collections/browse",
    "/collections/search",
    "/collections/{collection_id}",
    "/collections/{collection_id}/stats",
    "/news/",
    "/streaming/providers",
]


def _dependency_calls(dependant):
    for dep in dependant.dependencies:
        if dep.call is not None:
            yield dep.call
        yield from _dependency_calls(dep)


def _routes():
    """(path, methods, APIRoute) for every API route. Newer FastAPI keeps
    included routers nested instead of flattening them into app.routes."""
    try:
        from fastapi.routing import iter_route_contexts
    except ImportError:
        return [(r.path, r.methods, r) for r in app.routes if isinstance(r, APIRoute)]
    return [
        (ctx.path, ctx.methods, ctx.original_route)
        for ctx in iter_route_contexts(app.routes)
        if isinstance(ctx.original_route, APIRoute)
    ]


def _is_public(route):
    return any(public_cache_policy(call) for call in _dependency_calls(route.dependant))


def _needs_login(route):
    return any(isinstance(call, HTTPBearer) for call in _dependency_calls(route.dependant))


def test_route_walk_finds_the_app_routes():
    paths = {path for path, _, _ in _routes()}
    assert {"/movies/{id}", "/watchlist"} <= paths


class TestWhichRoutesArePublic:
    def test_no_login_route_is_publicly_cacheable(self):
        offenders = [path for path, _, r in _routes() if _is_public(r) and _needs_login(r)]
        assert offenders == []

    def test_only_get_routes_are_publicly_cacheable(self):
        offenders = [
            path for path, methods, r in _routes() if _is_public(r) and methods != {"GET"}
        ]
        assert offenders == []

    @pytest.mark.parametrize("path", PUBLIC_ROUTES)
    def test_content_route_is_publicly_cacheable(self, path):
        matches = [r for p, methods, r in _routes() if p == path and "GET" in methods]
        assert matches and all(_is_public(r) for r in matches)


class TestResponseHeaders:
    def test_db_backed_movie_is_cacheable(self, client, seed_movie):
        r = client.get("/movies/550")
        assert r.status_code == 200
        assert r.headers["cache-control"].startswith("public, max-age=")

    def test_tmdb_backed_list_is_cacheable(self, client):
        with patch("app.services.tmdb_search.get", return_value={"genres": []}):
            r = client.get("/search/genres")
        assert r.status_code == 200
        assert r.headers["cache-control"].startswith("public, max-age=")

    def test_not_found_is_not_cached(self, client):
        with patch("app.routers.movies.fetch_movie_from_tmdb_cached", return_value=None):
            r = client.get("/movies/999999")
        assert r.status_code == 404
        assert "public" not in r.headers.get("cache-control", "")

    def test_logged_in_route_is_not_public(self, client, seed_users):
        r = client.get("/watchlist")
        assert r.status_code == 200
        assert "public" not in r.headers.get("cache-control", "")
