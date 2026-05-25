"""
Tests for app.services.tmdb_client — sync + async TMDb GET with retry.
"""

import asyncio
from unittest.mock import MagicMock, patch

import httpx
import pytest


def _mock_response(status_code: int = 200, json_data=None, headers=None):
    m = MagicMock(spec=httpx.Response)
    m.status_code = status_code
    m.headers = headers or {}
    m.json.return_value = json_data if json_data is not None else {}
    if status_code >= 400:
        def _raise():
            raise httpx.HTTPStatusError("err", request=MagicMock(), response=m)
        m.raise_for_status.side_effect = _raise
    else:
        m.raise_for_status.return_value = None
    return m


class TestSyncGet:
    def test_success_returns_json(self):
        from app.services import tmdb_client
        resp = _mock_response(200, {"results": [1, 2, 3]})
        with patch.object(tmdb_client._sync_client, "get", return_value=resp) as mock_get:
            result = tmdb_client.get("/movie/1")
        assert result == {"results": [1, 2, 3]}
        # URL composed with BASE_URL
        called_url = mock_get.call_args[0][0]
        assert called_url == "https://api.themoviedb.org/3/movie/1"

    def test_passes_params(self):
        from app.services import tmdb_client
        resp = _mock_response(200, {"ok": True})
        with patch.object(tmdb_client._sync_client, "get", return_value=resp) as mock_get:
            tmdb_client.get("/movie/1", params={"a": "b"})
        assert mock_get.call_args.kwargs["params"] == {"a": "b"}

    def test_none_params_sent_as_empty_dict(self):
        from app.services import tmdb_client
        resp = _mock_response(200, {"ok": True})
        with patch.object(tmdb_client._sync_client, "get", return_value=resp) as mock_get:
            tmdb_client.get("/movie/1")
        assert mock_get.call_args.kwargs["params"] == {}

    def test_retries_on_429_then_succeeds(self):
        from app.services import tmdb_client
        bad = _mock_response(429, headers={"Retry-After": "0"})
        good = _mock_response(200, {"ok": True})
        with patch.object(
            tmdb_client._sync_client, "get", side_effect=[bad, good]
        ), patch("app.services.tmdb_client.time.sleep") as sleep_mock:
            result = tmdb_client.get("/x")
        assert result == {"ok": True}
        sleep_mock.assert_called_once()

    def test_retries_exhausted_raises(self):
        from app.services import tmdb_client
        bad = _mock_response(503, headers={"Retry-After": "0"})
        with patch.object(
            tmdb_client._sync_client, "get", return_value=bad
        ), patch("app.services.tmdb_client.time.sleep"):
            with pytest.raises(httpx.HTTPStatusError):
                tmdb_client.get("/x")

    def test_non_retry_4xx_raises_immediately(self):
        from app.services import tmdb_client
        resp = _mock_response(404)
        with patch.object(tmdb_client._sync_client, "get", return_value=resp):
            with pytest.raises(httpx.HTTPStatusError):
                tmdb_client.get("/x")

    def test_retry_delay_uses_retry_after_header(self):
        from app.services import tmdb_client
        resp = _mock_response(429, headers={"Retry-After": "7"})
        assert tmdb_client._retry_delay(resp, 0) == 7.0

    def test_retry_delay_exponential_backoff_when_no_header(self):
        from app.services import tmdb_client
        resp = _mock_response(429, headers={})
        # attempt=3 → min(2^3, 30) = 8
        assert tmdb_client._retry_delay(resp, 3) == 8
        # attempt=10 → capped at 30
        assert tmdb_client._retry_delay(resp, 10) == 30


class TestAsyncGet:
    def test_async_get_success(self):
        from app.services import tmdb_client
        resp = _mock_response(200, {"hello": "world"})

        async def _run():
            client = MagicMock()
            async def _get(url, params=None):
                return resp
            client.get = MagicMock(side_effect=_get)
            with patch(
                "app.services.tmdb_client._get_async_client",
                return_value=client,
            ):
                return await tmdb_client.async_get("/y", params={"k": "v"})

        result = asyncio.get_event_loop().run_until_complete(_run()) if not asyncio._get_running_loop() else None
        # asyncio.run is cleaner
        result = asyncio.run(_run())
        assert result == {"hello": "world"}

    def test_async_get_retries_then_succeeds(self):
        from app.services import tmdb_client
        bad = _mock_response(500, headers={"Retry-After": "0"})
        good = _mock_response(200, {"v": 1})

        async def _run():
            client = MagicMock()
            responses = iter([bad, good])
            async def _get(url, params=None):
                return next(responses)
            client.get = MagicMock(side_effect=_get)

            async def _sleep(_):
                return None

            with patch(
                "app.services.tmdb_client._get_async_client", return_value=client
            ), patch("app.services.tmdb_client.asyncio.sleep", side_effect=_sleep):
                return await tmdb_client.async_get("/z")

        assert asyncio.run(_run()) == {"v": 1}

    def test_async_get_retries_exhausted_raises(self):
        from app.services import tmdb_client
        bad = _mock_response(502, headers={"Retry-After": "0"})

        async def _run():
            client = MagicMock()
            async def _get(url, params=None):
                return bad
            client.get = MagicMock(side_effect=_get)

            async def _sleep(_):
                return None

            with patch(
                "app.services.tmdb_client._get_async_client", return_value=client
            ), patch("app.services.tmdb_client.asyncio.sleep", side_effect=_sleep):
                await tmdb_client.async_get("/z")

        with pytest.raises(httpx.HTTPStatusError):
            asyncio.run(_run())


class TestGetAsyncClient:
    def test_creates_client_lazily(self):
        from app.services import tmdb_client
        # Force re-creation
        tmdb_client._async_client = None
        c = tmdb_client._get_async_client()
        assert c is not None
        # Returns same instance on second call
        assert tmdb_client._get_async_client() is c
