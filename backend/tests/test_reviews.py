"""
Tests for review endpoints: add/update, delete, fetch, aggregate ratings.
"""

import pytest


def _delete_review(client, content_type, content_id):
    return client.request(
        "DELETE",
        "/reviews",
        json={"content_type": content_type, "content_id": content_id},
    )


def _add_review(client, text="Great film!", content_type="movie", content_id=550):
    return client.post(
        "/reviews",
        json={
            "content_type": content_type,
            "content_id": content_id,
            "review_text": text,
        },
    )


class TestReviewAdd:
    def test_add_review(self, client, seed_movie, seed_users):
        r = _add_review(client)
        assert r.status_code == 200
        assert r.json()["review_text"] == "Great film!"

    def test_add_review_for_show(self, client, seed_show, seed_users):
        r = _add_review(client, content_type="tv", content_id=1396)
        assert r.status_code == 200

    def test_add_empty_review_rejected(self, client, seed_movie, seed_users):
        r = _add_review(client, text="   ")
        assert r.status_code == 422

    def test_add_review_over_2000_chars_rejected(self, client, seed_movie, seed_users):
        r = _add_review(client, text="x" * 2001)
        assert r.status_code == 422

    def test_add_review_exactly_2000_chars_accepted(
        self, client, seed_movie, seed_users
    ):
        r = _add_review(client, text="x" * 2000)
        assert r.status_code == 200

    def test_update_existing_review(self, client, seed_movie, seed_users):
        _add_review(client, text="First version")
        r = _add_review(client, text="Updated version")
        assert r.status_code == 200
        assert r.json()["review_text"] == "Updated version"

    def test_update_creates_only_one_review(self, client, db, seed_movie, seed_users):
        from app.models.review import Review

        _add_review(client, text="First")
        _add_review(client, text="Second")
        db.expire_all()
        count = db.query(Review).filter_by(user_id="test-uid-1", content_id=550).count()
        assert count == 1


class TestReviewDelete:
    def test_delete_review(self, client, seed_movie, seed_users):
        _add_review(client)
        r = _delete_review(client, "movie", 550)
        assert r.status_code == 200

    def test_delete_nonexistent_returns_404(self, client, seed_movie, seed_users):
        r = _delete_review(client, "movie", 550)
        assert r.status_code == 404

    def test_delete_removes_from_db(self, client, db, seed_movie, seed_users):
        from app.models.review import Review

        _add_review(client)
        _delete_review(client, "movie", 550)
        db.expire_all()
        row = db.query(Review).filter_by(user_id="test-uid-1", content_id=550).first()
        assert row is None


class TestReviewFetch:
    def test_fetch_reviews_empty(self, client):
        r = client.get("/reviews?content_type=movie&content_id=550")
        assert r.status_code == 200
        assert r.json() == []

    def test_fetch_returns_review(self, client, seed_movie, seed_users):
        _add_review(client, text="Brilliant")
        r = client.get("/reviews?content_type=movie&content_id=550")
        assert len(r.json()) == 1
        assert r.json()[0]["review_text"] == "Brilliant"

    def test_fetch_includes_username(self, client, seed_movie, seed_users):
        _add_review(client)
        r = client.get("/reviews?content_type=movie&content_id=550")
        assert r.json()[0]["username"] == "alice"

    def test_fetch_limited_to_5(self, client, db, seed_movie, seed_users):
        from app.models.user import User
        from app.models.review import Review
        from datetime import datetime

        # Add 6 users and reviews
        for i in range(3, 10):
            db.add(User(id=f"uid-{i}", username=f"user{i}"))
        db.flush()
        for i in range(3, 10):
            db.add(
                Review(
                    user_id=f"uid-{i}",
                    content_type="movie",
                    content_id=550,
                    review_text=f"Review {i}",
                )
            )
        db.commit()

        r = client.get("/reviews/?content_type=movie&content_id=550")
        assert len(r.json()) <= 5


class TestAggregateRatings:
    def test_aggregate_no_ratings(self, client, seed_movie):
        r = client.get("/reviews/aggregate?content_type=movie&content_id=550")
        assert r.status_code == 200
        assert r.json()["average"] is None
        assert r.json()["count"] == 0

    def test_aggregate_with_ratings(self, client, db, seed_movie, seed_users):
        from app.models.watched import Watched
        from datetime import datetime

        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                watched_at=datetime.utcnow(),
                rating=8.0,
            )
        )
        db.commit()

        r = client.get("/reviews/aggregate?content_type=movie&content_id=550")
        assert r.json()["average"] == 8.0
        assert r.json()["count"] == 1

    def test_aggregate_averages_multiple_ratings(self, client, db, seed_movie):
        from app.models.user import User
        from app.models.watched import Watched
        from datetime import datetime

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob"))
        db.flush()
        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                watched_at=datetime.utcnow(),
                rating=6.0,
            )
        )
        db.add(
            Watched(
                user_id="test-uid-2",
                content_type="movie",
                content_id=550,
                watched_at=datetime.utcnow(),
                rating=8.0,
            )
        )
        db.commit()

        r = client.get("/reviews/aggregate?content_type=movie&content_id=550")
        assert r.json()["average"] == 7.0
        assert r.json()["count"] == 2

    def test_aggregate_ignores_null_ratings(self, client, db, seed_movie, seed_users):
        from app.models.watched import Watched
        from datetime import datetime

        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                watched_at=datetime.utcnow(),
                rating=None,
            )
        )
        db.commit()

        r = client.get("/reviews/aggregate?content_type=movie&content_id=550")
        assert r.json()["count"] == 0
        assert r.json()["average"] is None
