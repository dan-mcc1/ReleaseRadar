"""Tests for app.routers.person — TMDb-passthrough endpoints."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _clear_lrucaches():
    """Person service uses @lru_cache; clear between tests so patched returns
    aren't masked by a previous test's cache hit."""
    from app.services import tmdb_people

    for name in dir(tmdb_people):
        obj = getattr(tmdb_people, name)
        if hasattr(obj, "cache_clear"):
            obj.cache_clear()
    yield


class TestSearch:
    def test_returns_results_from_service(self, client):
        with patch(
            "app.routers.person.search_person",
            return_value=[{"id": 1, "name": "A"}],
        ) as m:
            r = client.get("/person/search?query=Alan")
        assert r.status_code == 200
        assert r.json() == [{"id": 1, "name": "A"}]
        m.assert_called_once_with("Alan")

    def test_missing_query_param_422(self, client):
        r = client.get("/person/search")
        assert r.status_code == 422


class TestPerson:
    def test_returns_person_payload(self, client):
        with patch(
            "app.routers.person.get_person",
            return_value={"id": 5, "name": "Brad Pitt"},
        ) as m:
            r = client.get("/person/5")
        assert r.status_code == 200
        assert r.json()["name"] == "Brad Pitt"
        m.assert_called_once_with(5, "")


class TestFullActorInfo:
    def test_sorts_credits_by_popularity_desc(self, client):
        payload = {
            "id": 5,
            "name": "X",
            "movie_credits": {
                "cast": [
                    {"id": 1, "popularity": 1.0},
                    {"id": 2, "popularity": 9.0},
                    {"id": 3, "popularity": 5.0},
                ],
                "crew": [
                    {"id": 4, "popularity": 2.0},
                    {"id": 5, "popularity": 8.0},
                ],
            },
            "tv_credits": {
                "cast": [
                    {"id": 6, "popularity": 3.0},
                    {"id": 7, "popularity": 7.0},
                ],
                "crew": [
                    {"id": 8, "popularity": 4.0},
                    {"id": 9, "popularity": 6.0},
                ],
            },
        }
        with patch(
            "app.routers.person.get_person", return_value=payload
        ):
            r = client.get("/person/5/info")
        body = r.json()
        assert [c["id"] for c in body["movie_credits"]["cast"]] == [2, 3, 1]
        assert [c["id"] for c in body["movie_credits"]["crew"]] == [5, 4]
        assert [c["id"] for c in body["tv_credits"]["cast"]] == [7, 6]
        assert [c["id"] for c in body["tv_credits"]["crew"]] == [9, 8]

    def test_missing_credit_blocks_dont_break(self, client):
        with patch(
            "app.routers.person.get_person",
            return_value={"id": 1, "name": "Y"},
        ):
            r = client.get("/person/1/info")
        assert r.status_code == 200
        assert r.json()["name"] == "Y"
