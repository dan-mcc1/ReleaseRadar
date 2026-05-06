"""
Tests for watched-episode endpoints: add/remove individual episodes,
season-level mark/unmark, next unwatched, and bulk next.
"""

import pytest
from datetime import datetime


class TestEpisodeWatchedAdd:
    def test_add_episode(self, client, seed_show, seed_users):
        r = client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        assert r.status_code == 200

    def test_add_episode_idempotent(self, client, seed_show, seed_users):
        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        r = client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        assert r.status_code == 200

    def test_add_creates_db_row(self, client, db, seed_show, seed_users):
        from app.models.episode_watched import EpisodeWatched

        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        db.expire_all()
        row = (
            db.query(EpisodeWatched)
            .filter_by(
                user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1
            )
            .first()
        )
        assert row is not None


class TestEpisodeWatchedRemove:
    def test_remove_episode(self, client, seed_show, seed_users):
        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        r = client.delete(
            "/watched-episode/remove",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        assert r.status_code == 200

    def test_remove_nonexistent(self, client, seed_show, seed_users):
        r = client.delete(
            "/watched-episode/remove",
            params={"show_id": 1396, "season_number": 1, "episode_number": 99},
        )
        assert r.status_code == 200

    def test_remove_deletes_db_row(self, client, db, seed_show, seed_users):
        from app.models.episode_watched import EpisodeWatched

        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        client.delete(
            "/watched-episode/remove",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        db.expire_all()
        row = (
            db.query(EpisodeWatched)
            .filter_by(
                user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1
            )
            .first()
        )
        assert row is None


class TestSeasonWatched:
    def test_mark_season_watched(self, client, seed_show, seed_users):
        r = client.post(
            "/watched-episode/season/add",
            params={"show_id": 1396, "season_number": 1},
        )
        assert r.status_code == 200

    def test_mark_season_creates_rows_for_all_episodes(
        self, client, db, seed_show, seed_users
    ):
        from app.models.episode_watched import EpisodeWatched

        client.post(
            "/watched-episode/season/add", params={"show_id": 1396, "season_number": 1}
        )
        db.expire_all()
        rows = (
            db.query(EpisodeWatched)
            .filter_by(user_id="test-uid-1", show_id=1396, season_number=1)
            .all()
        )
        assert len(rows) == 2  # seed_show has 2 episodes in season 1

    def test_unmark_season_removes_all_episodes(
        self, client, db, seed_show, seed_users
    ):
        from app.models.episode_watched import EpisodeWatched

        client.post(
            "/watched-episode/season/add", params={"show_id": 1396, "season_number": 1}
        )
        client.delete(
            "/watched-episode/season/remove",
            params={"show_id": 1396, "season_number": 1},
        )
        db.expire_all()
        rows = (
            db.query(EpisodeWatched)
            .filter_by(user_id="test-uid-1", show_id=1396, season_number=1)
            .all()
        )
        assert rows == []

    def test_mark_season_idempotent(self, client, db, seed_show, seed_users):
        from app.models.episode_watched import EpisodeWatched

        client.post(
            "/watched-episode/season/add", params={"show_id": 1396, "season_number": 1}
        )
        client.post(
            "/watched-episode/season/add", params={"show_id": 1396, "season_number": 1}
        )
        db.expire_all()
        rows = (
            db.query(EpisodeWatched)
            .filter_by(user_id="test-uid-1", show_id=1396, season_number=1)
            .all()
        )
        assert len(rows) == 2  # No duplicates


class TestGetWatchedEpisodes:
    def test_get_all_watched_empty(self, client, seed_users):
        r = client.get("/watched-episode")
        assert r.status_code == 200
        assert r.json() == []

    def test_get_watched_episodes_for_show(self, client, seed_show, seed_users):
        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        r = client.get("/watched-episode/1396")
        assert r.status_code == 200
        data = r.json()
        assert any(e["season_number"] == 1 and e["episode_number"] == 1 for e in data)

    def test_get_watched_episodes_isolated_per_user(self, db, seed_show):
        from tests.conftest import make_client

        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        c1.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        r = c2.get("/watched-episode/1396")
        assert r.json() == []


class TestNextUnwatched:
    def test_next_unwatched_when_none_watched(self, client, seed_show, seed_users):
        r = client.get("/watched-episode/1396/next")
        assert r.status_code == 200
        data = r.json()
        # First episode should be the next
        assert data is not None
        assert data["season_number"] == 1
        assert data["episode_number"] == 1

    def test_next_unwatched_after_watching_ep1(self, client, seed_show, seed_users):
        client.post(
            "/watched-episode/add",
            params={"show_id": 1396, "season_number": 1, "episode_number": 1},
        )
        r = client.get("/watched-episode/1396/next")
        data = r.json()
        assert data["episode_number"] == 2

    def test_next_unwatched_all_watched_returns_finished(
        self, client, seed_show, seed_users
    ):
        client.post(
            "/watched-episode/season/add", params={"show_id": 1396, "season_number": 1}
        )
        r = client.get("/watched-episode/1396/next")
        assert r.json()["finished"] is True

    def test_bulk_next_unwatched(self, client, seed_show, seed_users):
        r = client.get("/watched-episode/next/bulk?show_ids=1396")
        assert r.status_code == 200
        data = r.json()
        assert "1396" in data or 1396 in data
