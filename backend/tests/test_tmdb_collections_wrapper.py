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
