"""Tests for app.services.tmdb_people — TMDb person wrappers."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_caches():
    from app.services import tmdb_people
    for name in dir(tmdb_people):
        obj = getattr(tmdb_people, name)
        if hasattr(obj, "cache_clear"):
            obj.cache_clear()
    yield


class TestSearchPerson:
    def test_returns_results(self):
        from app.services.tmdb_people import search_person
        with patch(
            "app.services.tmdb_people.get",
            return_value={"results": [{"id": 1, "name": "X"}]},
        ) as m:
            assert search_person("X") == [{"id": 1, "name": "X"}]
        m.assert_called_once_with("/search/person", params={"query": "X"})

    def test_missing_results_returns_empty(self):
        from app.services.tmdb_people import search_person
        with patch("app.services.tmdb_people.get", return_value={}):
            assert search_person("y") == []


class TestGetPerson:
    def test_no_append(self):
        from app.services.tmdb_people import get_person
        with patch(
            "app.services.tmdb_people.get", return_value={"id": 5}
        ) as m:
            get_person(5, None)
        m.assert_called_once_with("/person/5", params={})

    def test_with_append(self):
        from app.services.tmdb_people import get_person
        with patch(
            "app.services.tmdb_people.get", return_value={"id": 5}
        ) as m:
            get_person(5, "combined_credits")
        assert m.call_args.kwargs["params"] == {
            "append_to_response": "combined_credits"
        }


class TestGetPersonCredits:
    def test_passes_through_payload(self):
        from app.services.tmdb_people import get_person_credits
        payload = {"cast": [], "crew": []}
        with patch(
            "app.services.tmdb_people.get", return_value=payload
        ) as m:
            assert get_person_credits(11) == payload
        m.assert_called_once_with("/person/11/combined_credits")


class TestGetExternalIds:
    def test_passes_through(self):
        from app.services.tmdb_people import get_external_ids
        with patch(
            "app.services.tmdb_people.get",
            return_value={"imdb_id": "nm0", "twitter_id": "x"},
        ) as m:
            result = get_external_ids(33)
        assert result == {"imdb_id": "nm0", "twitter_id": "x"}
        m.assert_called_once_with("/person/33/external_ids")
