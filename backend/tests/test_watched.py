"""
Tests for watched endpoints: add, remove, rate, fetch, pagination, sort,
search, tracking_count, and episode auto-mark.
"""

import pytest
import json
from datetime import datetime
from tests.conftest import make_client


def add_to_watched(client, content_type="movie", content_id=550):
    return client.request(
        "POST",
        "/watched/add",
        json={"content_type": content_type, "content_id": content_id},
        headers={"Content-Type": "application/json"},
    )


def remove_from_watched(client, content_type="movie", content_id=550):
    return client.request(
        "DELETE",
        "/watched/remove",
        content=json.dumps({"content_type": content_type, "content_id": content_id}),
        headers={"Content-Type": "application/json"},
    )


class TestWatchedAdd:
    def test_add_movie(self, client, seed_movie):
        r = add_to_watched(client)
        assert r.status_code == 200

    def test_add_show(self, client, seed_show):
        r = add_to_watched(client, "tv", 1396)
        assert r.status_code == 200

    def test_add_idempotent_movie(self, client, seed_movie):
        add_to_watched(client)
        r = add_to_watched(client)
        assert r.status_code == 200

    def test_add_invalid_content_type(self, client, seed_movie):
        r = client.request(
            "POST",
            "/watched/add",
            json={"content_type": "book", "content_id": 550},
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_add_increments_tracking_count(self, client, db, seed_movie):
        from app.models.movie import Movie

        add_to_watched(client)
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m.tracking_count == 1

    def test_two_users_increment_independently(self, db, seed_movie):
        from app.models.movie import Movie

        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        add_to_watched(c1)
        add_to_watched(c2)
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m.tracking_count == 2


class TestWatchedRemove:
    def test_remove_movie(self, client, seed_movie):
        add_to_watched(client)
        r = remove_from_watched(client)
        assert r.status_code == 200

    def test_remove_not_in_list(self, client, seed_movie):
        r = remove_from_watched(client)
        assert r.status_code == 200
        assert "not found" in r.json()["message"].lower()

    def test_remove_decrements_tracking_count_to_zero_deletes_movie(
        self, client, db, seed_movie
    ):
        from app.models.movie import Movie

        add_to_watched(client)
        remove_from_watched(client)
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m is None

    def test_remove_does_not_delete_movie_when_other_user_tracks(self, db, seed_movie):
        from app.models.movie import Movie

        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        add_to_watched(c1)
        add_to_watched(c2)
        remove_from_watched(c1)
        db.expire_all()
        m = db.query(Movie).filter_by(id=550).first()
        assert m is not None
        assert m.tracking_count == 1

    def test_remove_show_clears_episode_watched(self, client, db, seed_show):
        from app.models.episode_watched import EpisodeWatched

        # add_to_watched for a show marks all episodes as watched automatically
        add_to_watched(client, "tv", 1396)
        db.expire_all()
        rows_before = (
            db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).all()
        )
        assert len(rows_before) > 0  # episodes were marked watched
        remove_from_watched(client, "tv", 1396)
        db.expire_all()
        rows = (
            db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).all()
        )
        assert rows == []


class TestWatchedRate:
    def test_rate_movie(self, client, seed_movie):
        add_to_watched(client)
        r = client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 8.5},
        )
        assert r.status_code == 200
        assert r.json()["rating"] == 8.5

    def test_rate_not_in_watched_returns_404(self, client, seed_movie):
        r = client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 7.0},
        )
        assert r.status_code == 404

    def test_rate_null_clears_rating(self, client, seed_movie):
        add_to_watched(client)
        client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 8.0},
        )
        r = client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": None},
        )
        assert r.status_code == 200
        assert r.json()["rating"] is None

    def test_rate_updates_existing_rating(self, client, seed_movie):
        add_to_watched(client)
        client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 5.0},
        )
        r = client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 9.0},
        )
        assert r.json()["rating"] == 9.0


class TestWatchedFetch:
    def test_fetch_empty(self, client, seed_users):
        r = client.get("/watched")
        assert r.status_code == 200
        data = r.json()
        assert data["movies"] == []

    def test_fetch_includes_movie(self, client, seed_movie):
        add_to_watched(client)
        r = client.get("/watched")
        data = r.json()
        assert len(data["movies"]) == 1
        assert data["movies"][0]["id"] == 550

    def test_fetch_includes_user_rating(self, client, seed_movie):
        add_to_watched(client)
        client.patch(
            "/watched/rate",
            json={"content_type": "movie", "content_id": 550, "rating": 7.5},
        )
        r = client.get("/watched")
        assert r.json()["movies"][0]["user_rating"] == 7.5

    def test_fetch_returns_all_movies(self, client, db, seed_users):
        from app.models.movie import Movie
        from app.models.watched import Watched

        for i in range(1, 8):
            db.add(Movie(id=i, title=f"Movie {i}", tracking_count=0))
        db.flush()
        for i in range(1, 8):
            db.add(
                Watched(
                    user_id="test-uid-1",
                    content_type="movie",
                    content_id=i,
                    watched_at=datetime.utcnow(),
                )
            )
        db.commit()

        r = client.get("/watched")
        assert r.status_code == 200
        assert len(r.json()["movies"]) == 7

    def test_fetch_returns_both_rated_and_unrated(self, client, db, seed_users):
        from app.models.movie import Movie
        from app.models.watched import Watched

        db.add(Movie(id=1, title="Rated", tracking_count=0))
        db.add(Movie(id=2, title="Unrated", tracking_count=0))
        db.flush()
        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=1,
                watched_at=datetime.utcnow(),
                rating=7.0,
            )
        )
        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=2,
                watched_at=datetime.utcnow(),
                rating=None,
            )
        )
        db.commit()

        r = client.get("/watched")
        assert r.status_code == 200
        movies = r.json()["movies"]
        assert len(movies) == 2
        assert any(m["user_rating"] == 7.0 for m in movies)
        assert any(m["user_rating"] is None for m in movies)
