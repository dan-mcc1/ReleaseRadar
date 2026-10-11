"""Blocking work (DB queries, sync HTTP) inside an `async def` route runs on
the event loop and stalls every other request. These routes hand it to the
threadpool; the tests check the blocking step isn't running on the loop."""

import asyncio
from unittest.mock import patch

import pytest

from app.services.provider_utils import normalize_tmdb_watch_providers


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
        return True
    except RuntimeError:
        return False


@pytest.mark.parametrize("path, router, fetch", [
    ("/movies/550/info", "movies", "fetch_movie_from_tmdb_cached"),
    ("/tv/1396/full", "tv", "fetch_show_from_tmdb_cached"),
])
def test_provider_normalisation_runs_off_the_event_loop(client, path, router, fetch):
    # normalize_tmdb_watch_providers queries the Provider table.
    seen = []

    def recording_normalize(providers, db=None):
        seen.append(_on_event_loop())
        return normalize_tmdb_watch_providers(providers, db=db)

    payload = {
        "id": 1, "title": "X", "name": "X", "images": {"logos": []},
        "watch/providers": {"results": {"US": {"flatrate": [
            {"provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.png"},
        ]}}},
    }
    with patch(f"app.routers.{router}.{fetch}", return_value=payload), patch(
        f"app.routers.{router}.normalize_tmdb_watch_providers",
        side_effect=recording_normalize,
    ):
        r = client.get(path)

    assert r.status_code == 200
    assert seen == [False]
