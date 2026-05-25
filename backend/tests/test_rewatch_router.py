"""Tests for app.routers.rewatch."""

import pytest


class TestAddRewatch:
    def test_basic_add(self, client, seed_users):
        r = client.post(
            "/rewatch/add",
            json={"content_type": "movie", "content_id": 550, "rating": 4.5},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["content_type"] == "movie"
        assert body["content_id"] == 550
        assert body["rating"] == 4.5

    def test_invalid_content_type_422(self, client, seed_users):
        r = client.post(
            "/rewatch/add",
            json={"content_type": "audiobook", "content_id": 1},
        )
        assert r.status_code == 422

    def test_rating_out_of_range_422(self, client, seed_users):
        r = client.post(
            "/rewatch/add",
            json={"content_type": "movie", "content_id": 1, "rating": 6.0},
        )
        assert r.status_code == 422

    def test_notes_too_long_422(self, client, seed_users):
        r = client.post(
            "/rewatch/add",
            json={
                "content_type": "movie",
                "content_id": 1,
                "notes": "x" * 2001,
            },
        )
        assert r.status_code == 422

    def test_notes_are_stripped(self, client, seed_users):
        r = client.post(
            "/rewatch/add",
            json={"content_type": "movie", "content_id": 1, "notes": "  ok  "},
        )
        assert r.json()["notes"] == "ok"


class TestListRewatches:
    def test_empty(self, client, seed_users):
        r = client.get("/rewatch/")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_users_rewatches(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        db.add_all(
            [
                Rewatch(user_id="test-uid-1", content_type="movie", content_id=1, rating=4.0),
                Rewatch(user_id="test-uid-1", content_type="tv", content_id=2),
            ]
        )
        db.commit()
        r = client.get("/rewatch/")
        body = r.json()
        assert len(body) == 2

    def test_filter_by_content_type(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        db.add_all(
            [
                Rewatch(user_id="test-uid-1", content_type="movie", content_id=1),
                Rewatch(user_id="test-uid-1", content_type="tv", content_id=2),
            ]
        )
        db.commit()
        r = client.get("/rewatch/?content_type=tv")
        body = r.json()
        assert len(body) == 1
        assert body[0]["content_type"] == "tv"


class TestGetRewatchesFor:
    def test_count_and_rows(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        db.add_all(
            [
                Rewatch(user_id="test-uid-1", content_type="movie", content_id=42, rating=5.0),
                Rewatch(user_id="test-uid-1", content_type="movie", content_id=42, rating=4.0),
            ]
        )
        db.commit()
        r = client.get("/rewatch/movie/42")
        body = r.json()
        assert body["count"] == 2
        assert len(body["rewatches"]) == 2

    def test_other_users_rewatches_not_visible(
        self, client, client2, db, seed_users
    ):
        from app.models.rewatch import Rewatch

        db.add(
            Rewatch(user_id="test-uid-2", content_type="movie", content_id=42)
        )
        db.commit()
        r = client.get("/rewatch/movie/42")
        assert r.json()["count"] == 0


class TestUpdateRewatch:
    def test_update_rating_and_notes(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        rw = Rewatch(
            user_id="test-uid-1", content_type="movie", content_id=1, rating=3.0
        )
        db.add(rw)
        db.commit()

        r = client.patch(
            f"/rewatch/{rw.id}",
            json={"rating": 4.0, "notes": "  great  ", "would_rewatch": True},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["rating"] == 4.0
        assert body["notes"] == "great"
        assert body["would_rewatch"] is True

    def test_update_rating_out_of_range_422(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        rw = Rewatch(user_id="test-uid-1", content_type="movie", content_id=1)
        db.add(rw)
        db.commit()
        r = client.patch(f"/rewatch/{rw.id}", json={"rating": 10.0})
        assert r.status_code == 422

    def test_update_nonexistent_returns_404(self, client, seed_users):
        r = client.patch("/rewatch/999999", json={"rating": 4.0})
        assert r.status_code == 404

    def test_cannot_update_other_users_rewatch(
        self, client, db, seed_users
    ):
        from app.models.rewatch import Rewatch

        rw = Rewatch(user_id="test-uid-2", content_type="movie", content_id=1)
        db.add(rw)
        db.commit()
        r = client.patch(f"/rewatch/{rw.id}", json={"rating": 4.0})
        assert r.status_code == 404


class TestDeleteRewatch:
    def test_deletes_existing(self, client, db, seed_users):
        from app.models.rewatch import Rewatch

        rw = Rewatch(user_id="test-uid-1", content_type="movie", content_id=1)
        db.add(rw)
        db.commit()
        rid = rw.id
        r = client.delete(f"/rewatch/{rid}")
        assert r.status_code == 200
        assert r.json() == {"deleted": True}
        assert db.query(Rewatch).filter_by(id=rid).first() is None

    def test_nonexistent_returns_404(self, client, seed_users):
        r = client.delete("/rewatch/999999")
        assert r.status_code == 404
