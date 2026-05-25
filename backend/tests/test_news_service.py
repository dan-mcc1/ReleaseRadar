"""Tests for app.services.news_service — NewsAPI wrappers with TTL cache."""

import time
from unittest.mock import MagicMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def clear_cache():
    from app.services import news_service
    news_service._cache.clear()
    yield
    news_service._cache.clear()


def _resp(success=True, json_data=None):
    r = MagicMock()
    r.is_success = success
    r.json.return_value = json_data or {}
    return r


class TestFetch:
    def test_returns_cached_value_when_fresh(self):
        from app.services import news_service
        news_service._cache["k"] = (time.time(), {"articles": ["cached"]})
        # Should not hit httpx at all
        with patch("app.services.news_service.httpx.get") as m:
            result = news_service._fetch("k", "everything", {})
        assert result == {"articles": ["cached"]}
        m.assert_not_called()

    def test_expired_cache_re_fetches(self):
        from app.services import news_service
        news_service._cache["k"] = (
            time.time() - news_service.CACHE_TTL - 1,
            {"articles": ["stale"]},
        )
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "key", create=True
        ), patch(
            "app.services.news_service.httpx.get",
            return_value=_resp(json_data={"status": "ok", "articles": ["new"]}),
        ):
            result = news_service._fetch("k", "everything", {})
        assert result["articles"] == ["new"]

    def test_no_api_key_returns_empty(self):
        from app.services import news_service
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "", create=True
        ):
            assert news_service._fetch("z", "everything", {}) == {
                "articles": [],
                "totalResults": 0,
            }

    def test_http_failure_returns_empty(self):
        from app.services import news_service
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "key", create=True
        ), patch(
            "app.services.news_service.httpx.get",
            return_value=_resp(success=False),
        ):
            assert news_service._fetch("z", "everything", {}) == {
                "articles": [],
                "totalResults": 0,
            }

    def test_bad_status_returns_empty(self):
        from app.services import news_service
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "key", create=True
        ), patch(
            "app.services.news_service.httpx.get",
            return_value=_resp(json_data={"status": "error"}),
        ):
            assert news_service._fetch("z", "everything", {}) == {
                "articles": [],
                "totalResults": 0,
            }

    def test_exception_returns_empty(self):
        from app.services import news_service
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "key", create=True
        ), patch(
            "app.services.news_service.httpx.get",
            side_effect=httpx.RequestError("boom"),
        ):
            assert news_service._fetch("z", "everything", {}) == {
                "articles": [],
                "totalResults": 0,
            }

    def test_success_caches_result(self):
        from app.services import news_service
        payload = {"status": "ok", "articles": [1, 2]}
        with patch.object(
            news_service.settings, "NEWS_API_KEY", "key", create=True
        ), patch(
            "app.services.news_service.httpx.get",
            return_value=_resp(json_data=payload),
        ) as m:
            result = news_service._fetch("zz", "everything", {})
        assert result == payload
        assert "zz" in news_service._cache
        assert m.call_args.kwargs["params"]["apiKey"] == "key"


class TestPublicHelpers:
    def test_entertainment_news_uses_correct_query(self):
        from app.services import news_service
        with patch(
            "app.services.news_service._fetch",
            return_value={"articles": ["e"]},
        ) as m:
            assert news_service.get_entertainment_news(page=2, page_size=5) == {
                "articles": ["e"]
            }
        cache_key, endpoint, params = m.call_args[0]
        assert endpoint == "everything"
        assert "entertainment:2:5" in cache_key
        assert "movie OR film" in params["qInTitle"]
        assert params["page"] == 2
        assert params["pageSize"] == 5

    def test_movie_news_builds_query(self):
        from app.services import news_service
        with patch(
            "app.services.news_service._fetch", return_value={"articles": []}
        ) as m:
            news_service.get_movie_news()
        _, endpoint, params = m.call_args[0]
        assert endpoint == "everything"
        assert "box office" in params["qInTitle"]

    def test_tv_news_builds_query(self):
        from app.services import news_service
        with patch(
            "app.services.news_service._fetch", return_value={"articles": []}
        ) as m:
            news_service.get_tv_news()
        _, _, params = m.call_args[0]
        assert "premiere" in params["qInTitle"]

    def test_search_news_uses_query_and_excludes_domains(self):
        from app.services import news_service
        with patch(
            "app.services.news_service._fetch", return_value={"articles": []}
        ) as m:
            news_service.search_news("dune", page=1, page_size=10)
        cache_key, _, params = m.call_args[0]
        assert "search:dune:1:10" in cache_key
        assert params["qInTitle"] == "dune"
        assert "espn.com" in params["excludeDomains"]
