"""Tests for app.services.tmdb_collections — collection TMDb wrappers."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def clear_caches():
    from app.services import tmdb_collections
    for name in dir(tmdb_collections):
        obj = getattr(tmdb_collections, name)
        if hasattr(obj, "cache_clear"):
            obj.cache_clear()
    yield


class TestGetCollection:
    def test_returns_payload(self):
        from app.services.tmdb_collections import get_collection
        with patch(
            "app.services.tmdb_collections.get",
            return_value={"id": 10, "parts": []},
        ) as m:
            assert get_collection(10) == {"id": 10, "parts": []}
        m.assert_called_once_with("/collection/10")

    def test_returns_none_when_tmdb_404s(self):
        """TMDb deletes/merges duplicate collections; their ids then 404.
        tmdb_client.get raises on 404, so the wrapper must translate it."""
        import httpx
        from app.services.tmdb_collections import get_collection
        req = httpx.Request("GET", "https://api.themoviedb.org/3/collection/10")
        err = httpx.HTTPStatusError(
            "not found", request=req, response=httpx.Response(404, request=req)
        )
        with patch("app.services.tmdb_collections.get", side_effect=err):
            assert get_collection(10) is None

    def test_other_http_errors_still_raise(self):
        import httpx
        from app.services.tmdb_collections import get_collection
        req = httpx.Request("GET", "https://api.themoviedb.org/3/collection/10")
        err = httpx.HTTPStatusError(
            "unauthorized", request=req, response=httpx.Response(401, request=req)
        )
        with patch("app.services.tmdb_collections.get", side_effect=err):
            with pytest.raises(httpx.HTTPStatusError):
                get_collection(10)


class TestFetchCollection:
    """Uncached variant for the nightly ingest."""

    def test_hits_tmdb_every_call(self):
        from app.services.tmdb_collections import fetch_collection
        with patch(
            "app.services.tmdb_collections.get", return_value={"id": 10}
        ) as m:
            fetch_collection(10)
            fetch_collection(10)
        assert m.call_count == 2

    def test_returns_none_when_tmdb_404s(self):
        import httpx
        from app.services.tmdb_collections import fetch_collection
        req = httpx.Request("GET", "https://api.themoviedb.org/3/collection/10")
        err = httpx.HTTPStatusError(
            "not found", request=req, response=httpx.Response(404, request=req)
        )
        with patch("app.services.tmdb_collections.get", side_effect=err):
            assert fetch_collection(10) is None


class TestSearchCollectionsPaginated:
    def test_returns_structured_response(self):
        from app.services.tmdb_collections import search_collections_paginated
        data = {
            "results": [{"id": 1}],
            "total_pages": 3,
            "total_results": 25,
        }
        with patch(
            "app.services.tmdb_collections.get", return_value=data
        ) as m:
            result = search_collections_paginated("avengers", page=2)
        assert result == {
            "results": [{"id": 1}],
            "total_pages": 3,
            "total_results": 25,
        }
        m.assert_called_once_with(
            "/search/collection",
            params={"query": "avengers", "page": 2},
        )

    def test_total_pages_capped_at_500(self):
        from app.services.tmdb_collections import search_collections_paginated
        with patch(
            "app.services.tmdb_collections.get",
            return_value={"results": [], "total_pages": 999, "total_results": 5},
        ):
            result = search_collections_paginated("zzz")
        assert result["total_pages"] == 500

    def test_missing_keys_defaults(self):
        from app.services.tmdb_collections import search_collections_paginated
        with patch(
            "app.services.tmdb_collections.get", return_value={}
        ):
            result = search_collections_paginated("zzz")
        assert result == {
            "results": [],
            "total_pages": 1,
            "total_results": 0,
        }
