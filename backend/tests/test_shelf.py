"""
Tests for the shelf router (/shelf).

add_to_shelf calls ensure_movie_in_db / ensure_show_in_db which hit TMDb.
Those are patched to return the seeded Movie/Show objects so no network call is made.
"""

from unittest.mock import patch

import pytest

from tests.conftest import make_client


# ── Helpers ───────────────────────────────────────────────────────────────────


def _seed_user(db, uid="test-uid-1", tier="free"):
    from app.models.user import User

    db.add(User(id=uid, username="alice", email="alice@test.com", subscription_tier=tier))
    db.commit()


def _create_shelf(client, name="My Shelf", description=None):
    payload = {"name": name}
    if description:
        payload["description"] = description
    return client.post("/shelf", json=payload)


# ── Create shelf ──────────────────────────────────────────────────────────────


class TestCreateShelf:
    def test_creates_shelf(self, client, db):
        _seed_user(db)
        r = _create_shelf(client, "Favourites")
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Favourites"
        assert data["item_count"] == 0

    def test_creates_shelf_with_description(self, client, db):
        _seed_user(db)
        r = _create_shelf(client, "To Watch", "Movies I want to see")
        assert r.status_code == 200
        assert r.json()["description"] == "Movies I want to see"

    def test_free_user_can_create_up_to_three(self, client, db):
        _seed_user(db)
        for i in range(3):
            r = _create_shelf(client, f"Shelf {i}")
            assert r.status_code == 200

    def test_free_user_at_limit_returns_403(self, client, db):
        _seed_user(db)
        for i in range(3):
            _create_shelf(client, f"Shelf {i}")
        r = _create_shelf(client, "Shelf 4")
        assert r.status_code == 403
        assert r.json()["detail"]["error"] == "premium_required"

    def test_premium_user_can_exceed_free_limit(self, db):
        _seed_user(db, tier="premium")
        c = make_client("test-uid-1")
        for i in range(5):
            r = _create_shelf(c, f"Shelf {i}")
            assert r.status_code == 200


# ── List shelves ──────────────────────────────────────────────────────────────


class TestListShelves:
    def test_empty_list(self, client, db):
        _seed_user(db)
        r = client.get("/shelf")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_created_shelf(self, client, db):
        _seed_user(db)
        _create_shelf(client, "Classics")
        r = client.get("/shelf")
        assert r.status_code == 200
        assert len(r.json()) == 1
        assert r.json()[0]["name"] == "Classics"

    def test_returns_multiple_shelves(self, client, db):
        _seed_user(db)
        _create_shelf(client, "A")
        _create_shelf(client, "B")
        r = client.get("/shelf")
        assert len(r.json()) == 2

    def test_isolated_per_user(self, client, db):
        _seed_user(db, "test-uid-1")
        from app.models.user import User

        db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
        db.commit()
        _create_shelf(client, "Alice shelf")
        c2 = make_client("test-uid-2")
        r = c2.get("/shelf")
        assert r.json() == []


# ── Update shelf ──────────────────────────────────────────────────────────────


class TestUpdateShelf:
    def test_updates_name(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client, "Old Name").json()["id"]
        r = client.patch(f"/shelf/{shelf_id}", json={"name": "New Name"})
        assert r.status_code == 200
        assert r.json()["name"] == "New Name"

    def test_updates_description(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client, "S").json()["id"]
        r = client.patch(f"/shelf/{shelf_id}", json={"description": "updated"})
        assert r.status_code == 200
        assert r.json()["description"] == "updated"

    def test_wrong_user_returns_404(self, db):
        _seed_user(db, "test-uid-1")
        from app.models.user import User

        db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
        db.commit()
        c1 = make_client("test-uid-1")
        shelf_id = _create_shelf(c1, "Alice").json()["id"]
        c2 = make_client("test-uid-2")
        r = c2.patch(f"/shelf/{shelf_id}", json={"name": "Stolen"})
        assert r.status_code == 404


# ── Delete shelf ──────────────────────────────────────────────────────────────


class TestDeleteShelf:
    def test_deletes_shelf(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client, "Temp").json()["id"]
        r = client.delete(f"/shelf/{shelf_id}")
        assert r.status_code == 204
        assert client.get("/shelf").json() == []

    def test_wrong_user_returns_404(self, db):
        _seed_user(db, "test-uid-1")
        from app.models.user import User

        db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
        db.commit()
        c1 = make_client("test-uid-1")
        shelf_id = _create_shelf(c1, "Alice shelf").json()["id"]
        c2 = make_client("test-uid-2")
        r = c2.delete(f"/shelf/{shelf_id}")
        assert r.status_code == 404


# ── Add / remove items ────────────────────────────────────────────────────────


class TestShelfItems:
    def test_add_movie_item(self, client, db, seed_movie):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        with patch("app.services.shelf_service.ensure_movie_in_db", return_value=seed_movie):
            r = client.post(f"/shelf/{shelf_id}/items",
                            json={"content_type": "movie", "content_id": 550})
        assert r.status_code == 201
        assert r.json()["content_id"] == 550

    def test_add_item_idempotent(self, client, db, seed_movie):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        with patch("app.services.shelf_service.ensure_movie_in_db", return_value=seed_movie):
            r1 = client.post(f"/shelf/{shelf_id}/items",
                             json={"content_type": "movie", "content_id": 550})
            r2 = client.post(f"/shelf/{shelf_id}/items",
                             json={"content_type": "movie", "content_id": 550})
        assert r1.status_code == 201
        assert r2.status_code == 201
        # Item count should still be 1
        r_list = client.get("/shelf")
        assert r_list.json()[0]["item_count"] == 1

    def test_remove_item(self, client, db, seed_movie):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        with patch("app.services.shelf_service.ensure_movie_in_db", return_value=seed_movie):
            client.post(f"/shelf/{shelf_id}/items",
                        json={"content_type": "movie", "content_id": 550})
        r = client.delete(f"/shelf/{shelf_id}/items/movie/550")
        assert r.status_code == 204

    def test_remove_nonexistent_item_returns_404(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        r = client.delete(f"/shelf/{shelf_id}/items/movie/9999")
        assert r.status_code == 404

    def test_get_items_returns_movie(self, client, db, seed_movie):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        with patch("app.services.shelf_service.ensure_movie_in_db", return_value=seed_movie):
            client.post(f"/shelf/{shelf_id}/items",
                        json={"content_type": "movie", "content_id": 550})
        r = client.get(f"/shelf/{shelf_id}/items")
        assert r.status_code == 200
        assert len(r.json()["movies"]) == 1
        assert r.json()["movies"][0]["id"] == 550

    def test_get_items_wrong_user_returns_404(self, db, seed_movie):
        _seed_user(db, "test-uid-1")
        from app.models.user import User

        db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
        db.commit()
        c1 = make_client("test-uid-1")
        shelf_id = _create_shelf(c1).json()["id"]
        c2 = make_client("test-uid-2")
        r = c2.get(f"/shelf/{shelf_id}/items")
        assert r.status_code == 404


# ── Item-shelves lookup ───────────────────────────────────────────────────────


class TestItemShelves:
    def test_returns_shelf_ids_for_item(self, client, db, seed_movie):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        with patch("app.services.shelf_service.ensure_movie_in_db", return_value=seed_movie):
            client.post(f"/shelf/{shelf_id}/items",
                        json={"content_type": "movie", "content_id": 550})
        r = client.get("/shelf/item-shelves?content_type=movie&content_id=550")
        assert r.status_code == 200
        assert shelf_id in r.json()

    def test_returns_empty_if_not_on_any_shelf(self, client, db):
        _seed_user(db)
        r = client.get("/shelf/item-shelves?content_type=movie&content_id=9999")
        assert r.status_code == 200
        assert r.json() == []


# ── Notify toggle ─────────────────────────────────────────────────────────────


class TestShelfNotify:
    def test_toggle_notify_off(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        r = client.patch(f"/shelf/{shelf_id}/notify", json={"notify": False})
        assert r.status_code == 200
        assert r.json()["notify"] is False

    def test_toggle_notify_on(self, client, db):
        _seed_user(db)
        shelf_id = _create_shelf(client).json()["id"]
        client.patch(f"/shelf/{shelf_id}/notify", json={"notify": False})
        r = client.patch(f"/shelf/{shelf_id}/notify", json={"notify": True})
        assert r.status_code == 200
        assert r.json()["notify"] is True
