"""Tests for app.routers.watch_status — POST /watch-status/set."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _no_bg_tasks():
    """Stub out the heavy background-task helpers so the test doesn't try to
    hit TMDb or open new sessions in worker threads."""
    with patch("app.routers.watch_status.populate_show_bg"), patch(
        "app.routers.watch_status.populate_movie_bg"
    ), patch("app.routers.watch_status.ensure_providers_populated_bg"), patch(
        "app.routers.watch_status.ensure_trailers_populated_bg"
    ), patch(
        "app.routers.watch_status.sync_watched_episodes_bg"
    ):
        yield


class TestSetWatchStatus:
    def test_invalid_content_type_returns_400(self, client, seed_users):
        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "audio",
                "content_id": 1,
                "target": "Want To Watch",
            },
        )
        assert r.status_code == 400

    def test_invalid_target_returns_400(self, client, seed_users):
        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "movie",
                "content_id": 1,
                "target": "Pondering",
            },
        )
        assert r.status_code == 400

    def test_add_to_watchlist(self, client, db, seed_users, seed_movie):
        from app.models.watchlist import Watchlist

        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "movie",
                "content_id": 550,
                "target": "Want To Watch",
                "current": "none",
            },
        )
        assert r.status_code == 200
        assert r.json() == {"status": "Want To Watch"}
        assert (
            db.query(Watchlist)
            .filter_by(user_id="test-uid-1", content_id=550)
            .first()
            is not None
        )

    def test_add_to_currently_watching(self, client, db, seed_users, seed_show):
        from app.models.currently_watching import CurrentlyWatching

        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "tv",
                "content_id": 1396,
                "target": "Currently Watching",
                "current": "none",
            },
        )
        assert r.status_code == 200
        assert (
            db.query(CurrentlyWatching)
            .filter_by(user_id="test-uid-1", content_id=1396)
            .first()
            is not None
        )

    def test_add_to_watched_movie(self, client, db, seed_users, seed_movie):
        from app.models.watched import Watched

        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "movie",
                "content_id": 550,
                "target": "Watched",
                "current": "none",
            },
        )
        assert r.status_code == 200
        assert (
            db.query(Watched)
            .filter_by(user_id="test-uid-1", content_id=550)
            .first()
            is not None
        )

    def test_swap_from_watchlist_to_watched(
        self, client, db, seed_users, seed_movie
    ):
        """Moving between lists: target added, then current removed."""
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        r = client.post(
            "/watch-status/set",
            json={
                "content_type": "movie",
                "content_id": 550,
                "target": "Watched",
                "current": "Want To Watch",
            },
        )
        assert r.status_code == 200
        assert (
            db.query(Watchlist)
            .filter_by(user_id="test-uid-1", content_id=550)
            .first()
            is None
        )
        assert (
            db.query(Watched)
            .filter_by(user_id="test-uid-1", content_id=550)
            .first()
            is not None
        )
