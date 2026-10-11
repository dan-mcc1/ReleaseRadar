"""Unauthenticated routes that proxy TMDb are rate limited per client, so a
scraper can't burn the TMDb quota (and stall every worker thread in TMDb's
429 backoff). Their inputs are also bounded so they can't bypass caching."""

from unittest.mock import patch

import pytest
from fastapi.security import HTTPBearer

from app.config import settings
from app.core import limiter as limiter_module
from tests.test_http_cache import _dependency_calls, _routes

# Public routes that never reach TMDb, or that carry their own slowapi limit.
NOT_TMDB_BACKED = {
    "/billing/webhook",          # Stripe, signature-checked
    "/events/stream",            # single-use SSE token
    "/ical/feed/{token}",        # slowapi 6/minute per token
    "/notifications/unsubscribe",  # HMAC-checked
    "/user/check-username",      # slowapi 30/minute
    "/user/check-email-banned",  # slowapi 10/minute
    "/reviews",                  # DB only
    "/reviews/aggregate",
    "/season-rating/aggregate",
    "/streaming/providers",      # DB only
}


@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setattr(limiter_module.limiter, "enabled", True)
    limiter_module._public_storage.reset()
    yield
    limiter_module._public_storage.reset()


def _is_rate_limited(route):
    return any(
        getattr(call, "rate_limit_scope", None) for call in _dependency_calls(route.dependant)
    )


def _needs_login(route):
    return any(isinstance(call, HTTPBearer) for call in _dependency_calls(route.dependant))


class TestEveryPublicRouteIsLimited:
    def test_no_unauthenticated_tmdb_route_is_unlimited(self):
        offenders = sorted(
            path for path, _, r in _routes()
            if not _needs_login(r) and path not in NOT_TMDB_BACKED and not _is_rate_limited(r)
        )
        assert offenders == []


class TestLimitBehaviour:
    def test_requests_past_the_limit_get_429_with_retry_after(self, client, limits_on, monkeypatch):
        monkeypatch.setattr(settings, "PUBLIC_RATE_LIMIT", "2/minute")
        with patch("app.services.tmdb_search.get", return_value={"genres": []}):
            codes = [client.get("/search/genres").status_code for _ in range(3)]
            r = client.get("/search/genres")
        assert codes == [200, 200, 429]
        assert int(r.headers["retry-after"]) >= 1

    def test_search_has_its_own_tighter_budget(self, client, limits_on, monkeypatch):
        # Each search fans out to four TMDb calls.
        monkeypatch.setattr(settings, "SEARCH_RATE_LIMIT", "1/minute")
        with patch("app.routers.search.get_movie_search_results", return_value=[]), \
             patch("app.routers.search.get_tv_search_results", return_value=[]), \
             patch("app.routers.search.get_person_search_results", return_value=[]), \
             patch("app.routers.search.get_collection_search_results", return_value=[]):
            first = client.get("/search?query=dune").status_code
            second = client.get("/search?query=arrival").status_code
        assert (first, second) == (200, 429)

    def test_limit_is_off_when_the_limiter_is_disabled(self, client):
        # conftest disables slowapi for the suite; the public limit follows it.
        with patch("app.services.tmdb_search.get", return_value={"genres": []}):
            codes = {client.get("/search/genres").status_code for _ in range(5)}
        assert codes == {200}


class TestAppendParam:
    def test_show_append_is_filtered_and_normalised(self, client):
        with patch("app.routers.tv.fetch_show_from_tmdb_cached",
                   return_value={"id": 990001}) as fetch:
            client.get("/tv/990001?append=videos,%3Cscript%3E,credits,videos")
        fetch.assert_called_once_with(990001, "credits,videos")

    def test_movie_append_with_only_unknown_fields_becomes_none(self, client):
        with patch("app.routers.movies.fetch_movie_from_tmdb_cached",
                   return_value={"id": 990002}) as fetch:
            client.get("/movies/990002?append=bogus,also-bogus")
        fetch.assert_called_once_with(990002, None)


class TestEpisodeRouteCache:
    def test_repeat_views_reuse_one_tmdb_call(self, client):
        with patch("app.services.tmdb_tv.get", return_value={"id": 5, "name": "Pilot"}) as get:
            first = client.get("/tv/990003/season/1/episode/2")
            second = client.get("/tv/990003/season/1/episode/2")
        assert first.json() == second.json() == {"id": 5, "name": "Pilot", "show_id": 990003}
        assert get.call_count == 1


class TestDateParams:
    """Date query params used to be plain strings: garbage went straight into
    SQL (a 500 on Postgres) or to TMDb."""

    def test_season_calendar_rejects_a_bad_date(self, client, seed_show):
        r = client.get("/tv/1396/season_calendar?min_date=nope&max_date=2026-01-01")
        assert r.status_code == 422

    def test_season_calendar_accepts_real_dates(self, client, seed_show):
        r = client.get("/tv/1396/season_calendar?min_date=2008-01-01&max_date=2008-01-31")
        assert r.status_code == 200
        assert [e["episode_number"] for e in r.json()] == [1, 2]

    @pytest.mark.parametrize("kind", ["tv", "movie"])
    def test_upcoming_rejects_a_bad_date(self, client, kind):
        r = client.get(f"/search/{kind}/upcoming?min_date=2026-13-45&max_date=2026-12-31")
        assert r.status_code == 422

    def test_upcoming_passes_iso_dates_to_tmdb(self, client):
        with patch("app.services.tmdb_search.get",
                   return_value={"results": [], "total_pages": 1}) as get:
            r = client.get("/search/movie/upcoming?min_date=2031-02-03&max_date=2031-03-04")
        assert r.status_code == 200
        params = get.call_args.kwargs["params"]
        assert (params["primary_release_date.gte"], params["primary_release_date.lte"]) == (
            "2031-02-03", "2031-03-04")
