"""
Tests for currently-watching endpoints and list-transition logic.
Moving items between Watchlist → Currently Watching → Watched.
"""

import pytest
import json
from datetime import datetime
from tests.conftest import make_client


def add_cw(client, content_type="tv", content_id=1396):
    return client.request(
        "POST",
        "/currently-watching/add",
        json={"content_type": content_type, "content_id": content_id},
        headers={"Content-Type": "application/json"},
    )


def remove_cw(client, content_type="tv", content_id=1396):
    return client.request(
        "DELETE",
        "/currently-watching/remove",
        content=json.dumps({"content_type": content_type, "content_id": content_id}),
        headers={"Content-Type": "application/json"},
    )


class TestCurrentlyWatchingAdd:
    def test_add_show(self, client, seed_show):
        r = add_cw(client)
        assert r.status_code == 200

    def test_add_movie(self, client, seed_movie):
        r = add_cw(client, "movie", 550)
        assert r.status_code == 200

    def test_add_invalid_type(self, client, seed_show):
        r = client.request(
            "POST",
            "/currently-watching/add",
            json={"content_type": "podcast", "content_id": 1396},
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_add_idempotent(self, client, seed_show):
        add_cw(client)
        r = add_cw(client)
        assert r.status_code == 200


class TestCurrentlyWatchingRemove:
    def test_remove_show(self, client, seed_show):
        add_cw(client)
        r = remove_cw(client)
        assert r.status_code == 200

    def test_remove_not_present(self, client, seed_show):
        r = remove_cw(client)
        assert r.status_code == 200

    def test_remove_invalid_type(self, client):
        r = client.request(
            "DELETE",
            "/currently-watching/remove",
            content=json.dumps({"content_type": "podcast", "content_id": 1}),
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400


class TestCurrentlyWatchingFetch:
    def test_fetch_empty(self, client, seed_users):
        r = client.get("/currently-watching")
        assert r.status_code == 200

    def test_fetch_shows_added_item(self, client, seed_show):
        add_cw(client)
        r = client.get("/currently-watching")
        assert r.status_code == 200
        data = r.json()
        # Response structure varies by service — just confirm no error and show is present
        shows = data.get("shows") or data
        assert any(
            s.get("id") == 1396 for s in (shows if isinstance(shows, list) else [])
        )


class TestListTransitions:
    """Verify bulk-status reflects correct state as items move between lists."""

    def _status(self, client, content_type, content_id):
        r = client.request(
            "POST",
            "/watchlist/status/bulk",
            json=[{"content_type": content_type, "content_id": content_id}],
            headers={"Content-Type": "application/json"},
        )
        return r.json()[f"{content_type}:{content_id}"]["status"]

    def test_watchlist_to_currently_watching(self, client, db, seed_show):
        from app.models.watchlist import Watchlist

        db.add(
            Watchlist(
                user_id="test-uid-1",
                content_type="tv",
                content_id=1396,
                added_at=datetime.utcnow(),
            )
        )
        db.commit()
        assert self._status(client, "tv", 1396) == "Want To Watch"

        add_cw(client)
        # Currently Watching takes priority
        assert self._status(client, "tv", 1396) == "Currently Watching"

    def test_currently_watching_to_watched(self, client, db, seed_show):
        from app.models.currently_watching import CurrentlyWatching
        from app.models.show import Show
        from app.models.watched import Watched

        # Set tracking_count=1 so removing CW doesn't delete the show
        db.query(Show).filter_by(id=1396).update({"tracking_count": 1})
        db.add(
            CurrentlyWatching(
                user_id="test-uid-1",
                content_type="tv",
                content_id=1396,
                added_at=datetime.utcnow(),
            )
        )
        db.commit()
        assert self._status(client, "tv", 1396) == "Currently Watching"

        # Remove from CW — tracking_count drops to 0 but add Watched directly
        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="tv",
                content_id=1396,
                watched_at=datetime.utcnow(),
            )
        )
        db.commit()
        db.query(CurrentlyWatching).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=1396
        ).delete()
        db.commit()
        assert self._status(client, "tv", 1396) == "Watched"

    def test_status_isolated_per_user(self, db, seed_show):
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        c1.request(
            "POST",
            "/watched/add",
            json={"content_type": "tv", "content_id": 1396},
            headers={"Content-Type": "application/json"},
        )

        r = c2.request(
            "POST",
            "/watchlist/status/bulk",
            json=[{"content_type": "tv", "content_id": 1396}],
            headers={"Content-Type": "application/json"},
        )
        assert r.json()["tv:1396"]["status"] == "none"
