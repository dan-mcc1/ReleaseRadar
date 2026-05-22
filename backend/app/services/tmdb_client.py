import asyncio
import time

import httpx

from app.config import settings

BASE_URL = "https://api.themoviedb.org/3"
_HEADERS = {
    "Authorization": f"Bearer {settings.TMDB_BEARER_TOKEN}",
    "Accept": "application/json",
}
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
_MAX_RETRIES = 5

# Sync client — used by background tasks and nightly refresh loops.
# HTTPTransport(retries=2) handles connection-level errors; status-based
# retry is handled in the get() loop below.
_sync_client = httpx.Client(
    http2=True,
    headers=_HEADERS,
    timeout=10.0,
    follow_redirects=False,
    transport=httpx.HTTPTransport(retries=2),
)

# Async client — shared across all hot request-handling routes.
# Created lazily so it lives inside the event loop that first touches it.
_async_client: httpx.AsyncClient | None = None


def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None:
        _async_client = httpx.AsyncClient(
            http2=True,
            headers=_HEADERS,
            timeout=10.0,
            follow_redirects=False,
            transport=httpx.AsyncHTTPTransport(retries=2),
        )
    return _async_client


def _retry_delay(res: httpx.Response, attempt: int) -> float:
    retry_after = res.headers.get("Retry-After")
    return float(retry_after) if retry_after else min(2**attempt, 30)


def get(path: str, params: dict | None = None):
    """Synchronous TMDb GET — for background tasks and nightly refresh loops."""
    res: httpx.Response | None = None
    for attempt in range(_MAX_RETRIES + 1):
        res = _sync_client.get(f"{BASE_URL}{path}", params=params or {})
        if res.status_code not in _RETRY_STATUSES:
            res.raise_for_status()
            return res.json()
        if attempt < _MAX_RETRIES:
            time.sleep(_retry_delay(res, attempt))
    res.raise_for_status()


async def async_get(path: str, params: dict | None = None):
    """Async TMDb GET — for hot request-handling routes (HTTP/2 multiplexed)."""
    client = _get_async_client()
    res: httpx.Response | None = None
    for attempt in range(_MAX_RETRIES + 1):
        res = await client.get(f"{BASE_URL}{path}", params=params or {})
        if res.status_code not in _RETRY_STATUSES:
            res.raise_for_status()
            return res.json()
        if attempt < _MAX_RETRIES:
            await asyncio.sleep(_retry_delay(res, attempt))
    res.raise_for_status()
