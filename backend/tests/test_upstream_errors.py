"""Errors from TMDb (and other upstream APIs) used to escape as 500s: a bad
title id looked like a server bug and landed in Sentry."""

from unittest.mock import patch

import httpx


def _status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://api.themoviedb.org/3/tv/123")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError(f"{status}", request=request, response=response)


def _get_full_show(client, error):
    with patch("app.routers.tv.fetch_show_from_tmdb_cached", side_effect=error):
        return client.get("/tv/123/full")


def test_unknown_title_is_a_404(client):
    assert _get_full_show(client, _status_error(404)).status_code == 404


def test_upstream_server_error_is_a_502(client):
    assert _get_full_show(client, _status_error(503)).status_code == 502


def test_upstream_rate_limit_is_a_503(client):
    r = _get_full_show(client, _status_error(429))
    assert r.status_code == 503
    assert "retry-after" in r.headers


def test_upstream_unreachable_is_a_502(client):
    timeout = httpx.ConnectTimeout("timed out", request=httpx.Request("GET", "https://x"))
    assert _get_full_show(client, timeout).status_code == 502
