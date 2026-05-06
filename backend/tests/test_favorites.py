"""
Tests for favorites endpoints: add, remove, status, fetch, edge cases.
"""

import pytest
from tests.conftest import make_client


def _delete_favorite(client, content_type, content_id):
    return client.request(
        "DELETE",
        "/favorites/remove",
        json={"content_type": content_type, "content_id": content_id},
    )


class TestFavoritesAdd:
    def test_add_movie_favorite(self, client, seed_movie, seed_users):
        r = client.post(
            "/favorites/add", json={"content_type": "movie", "content_id": 550}
        )
        assert r.status_code == 200

    def test_add_show_favorite(self, client, seed_show, seed_users):
        r = client.post(
            "/favorites/add", json={"content_type": "tv", "content_id": 1396}
        )
        assert r.status_code == 200

    def test_add_invalid_type(self, client, seed_users):
        r = client.post(
            "/favorites/add", json={"content_type": "podcast", "content_id": 1}
        )
        assert r.status_code == 400

    def test_add_idempotent(self, client, seed_movie, seed_users):
        client.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        r = client.post(
            "/favorites/add", json={"content_type": "movie", "content_id": 550}
        )
        assert r.status_code == 200

    def test_favorite_does_not_require_watchlist(self, client, seed_movie, seed_users):
        # Item doesn't need to be on watchlist to be favorited
        r = client.post(
            "/favorites/add", json={"content_type": "movie", "content_id": 550}
        )
        assert r.status_code == 200


class TestFavoritesRemove:
    def test_remove_favorite(self, client, seed_movie, seed_users):
        client.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        r = _delete_favorite(client, "movie", 550)
        assert r.status_code == 200

    def test_remove_nonexistent(self, client, seed_users):
        r = _delete_favorite(client, "movie", 9999)
        assert r.status_code == 200
        assert "not found" in r.json()["message"].lower()

    def test_remove_does_not_affect_other_user(self, db, seed_movie):
        from app.models.user import User
        from app.models.favorite import Favorite

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob"))
        db.commit()
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        c1.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        c2.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        _delete_favorite(c1, "movie", 550)
        db.expire_all()
        remaining = db.query(Favorite).filter_by(content_id=550).all()
        assert len(remaining) == 1
        assert remaining[0].user_id == "test-uid-2"


class TestFavoritesStatus:
    def test_status_false_when_not_favorited(self, client, seed_movie, seed_users):
        r = client.get("/favorites/status?content_type=movie&content_id=550")
        assert r.status_code == 200
        assert r.json()["favorited"] is False

    def test_status_true_after_add(self, client, seed_movie, seed_users):
        client.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        r = client.get("/favorites/status?content_type=movie&content_id=550")
        assert r.json()["favorited"] is True

    def test_status_false_after_remove(self, client, seed_movie, seed_users):
        client.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        _delete_favorite(client, "movie", 550)
        r = client.get("/favorites/status?content_type=movie&content_id=550")
        assert r.json()["favorited"] is False


class TestFavoritesFetch:
    def test_fetch_empty(self, client, seed_users):
        r = client.get("/favorites")
        assert r.status_code == 200
        data = r.json()
        assert data["movies"] == []
        assert data["shows"] == []

    def test_fetch_includes_movie(self, client, seed_movie, seed_users):
        client.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        r = client.get("/favorites")
        assert len(r.json()["movies"]) == 1
        assert r.json()["movies"][0]["id"] == 550

    def test_fetch_includes_show(self, client, seed_show, seed_users):
        client.post("/favorites/add", json={"content_type": "tv", "content_id": 1396})
        r = client.get("/favorites")
        assert len(r.json()["shows"]) == 1

    def test_favorites_isolated_per_user(self, db, seed_movie):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob"))
        db.commit()
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        c1.post("/favorites/add", json={"content_type": "movie", "content_id": 550})
        r = c2.get("/favorites")
        assert r.json()["movies"] == []
