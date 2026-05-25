"""Tests for app.routers.box_office.

The TMDb client is mocked at ``app.routers.box_office.async_get``, which the
yearly/monthly/all-time helpers all use. In-memory caches are cleared between
tests so we always exercise the live path.
"""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _clear_caches():
    from app.routers import box_office

    box_office._cache.clear()
    box_office._all_time_cache.clear()
    yield
    box_office._cache.clear()
    box_office._all_time_cache.clear()


def _discover_payload(ids):
    return {"results": [{"id": i} for i in ids]}


def _movie_payload(mid: int, revenue: int = 100_000_000):
    return {
        "id": mid,
        "title": f"Movie {mid}",
        "poster_path": f"/{mid}.jpg",
        "backdrop_path": f"/{mid}b.jpg",
        "release_date": "2024-01-01",
        "revenue": revenue,
        "budget": 50_000_000,
        "vote_average": 7.0,
        "runtime": 120,
        "genres": [],
    }


class TestYearly:
    def test_returns_ranked_movies(self, client):
        async def _fake_get(path, params=None):
            if path == "/discover/movie":
                return _discover_payload([1, 2])
            mid = int(path.split("/")[-1])
            return _movie_payload(mid)

        with patch("app.routers.box_office.async_get", side_effect=_fake_get):
            r = client.get("/box-office/yearly?year=2024&limit=5")
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 2
        assert body[0]["rank"] == 1
        assert body[1]["rank"] == 2

    def test_skips_movies_with_no_revenue(self, client):
        async def _fake_get(path, params=None):
            if path == "/discover/movie":
                return _discover_payload([1, 2])
            mid = int(path.split("/")[-1])
            # First movie has no revenue → should be skipped
            return _movie_payload(mid, revenue=0 if mid == 1 else 500_000_000)

        with patch("app.routers.box_office.async_get", side_effect=_fake_get):
            r = client.get("/box-office/yearly?year=2024")
        body = r.json()
        assert len(body) == 1
        assert body[0]["id"] == 2

    def test_year_lower_bound_rejected(self, client):
        r = client.get("/box-office/yearly?year=1899")
        assert r.status_code == 422

    def test_limit_max_50(self, client):
        r = client.get("/box-office/yearly?year=2024&limit=100")
        assert r.status_code == 422

    def test_empty_discover_returns_empty_list(self, client):
        async def _fake_get(*a, **kw):
            return {"results": []}

        with patch("app.routers.box_office.async_get", side_effect=_fake_get):
            r = client.get("/box-office/yearly?year=2024")
        assert r.json() == []

    def test_discover_failure_returns_502(self, client):
        async def _raise(*a, **kw):
            raise RuntimeError("tmdb dead")

        with patch("app.routers.box_office.async_get", side_effect=_raise):
            r = client.get("/box-office/yearly?year=2024")
        assert r.status_code == 502


class TestMonthly:
    def test_basic_monthly_path(self, client):
        async def _fake_get(path, params=None):
            if path == "/discover/movie":
                # confirm the date range params were set for the month
                assert params["primary_release_date.gte"] == "2024-06-01"
                assert params["primary_release_date.lte"] == "2024-06-30"
                return _discover_payload([10])
            return _movie_payload(10)

        with patch("app.routers.box_office.async_get", side_effect=_fake_get):
            r = client.get("/box-office/monthly?year=2024&month=6&limit=5")
        assert r.status_code == 200
        assert r.json()[0]["id"] == 10

    def test_invalid_month_rejected(self, client):
        r = client.get("/box-office/monthly?year=2024&month=13&limit=5")
        assert r.status_code == 422


class TestAllTime:
    def test_returns_ranked_with_offset_for_page(self, client):
        async def _fake_get(path, params=None):
            if path == "/discover/movie":
                return _discover_payload([100, 101])
            mid = int(path.split("/")[-1])
            return _movie_payload(mid, revenue=300_000_000)

        with patch("app.routers.box_office.async_get", side_effect=_fake_get):
            r = client.get("/box-office/all-time?page=2&limit=20")
        body = r.json()
        # rank starts at (page-1)*limit + 1 = 21
        assert body[0]["rank"] == 21

    def test_page_max_20(self, client):
        r = client.get("/box-office/all-time?page=21")
        assert r.status_code == 422

    def test_empty_discover_returns_empty(self, client):
        async def _fake(*a, **kw):
            return {"results": []}

        with patch("app.routers.box_office.async_get", side_effect=_fake):
            r = client.get("/box-office/all-time")
        assert r.json() == []
