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


def _lists_holding(db, content_type, content_id, uid="test-uid-1"):
    from app.models.currently_watching import CurrentlyWatching
    from app.models.watched import Watched
    from app.models.watchlist import Watchlist

    db.expire_all()
    return {
        name
        for name, model in (
            ("Want To Watch", Watchlist),
            ("Currently Watching", CurrentlyWatching),
            ("Watched", Watched),
        )
        if db.query(model)
        .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
        .first()
    }


class TestServerDecidesTheCurrentList:
    """The client's `current` can be stale (another tab, a background
    auto-complete, the nightly reactivation), so the server looks up where
    the title actually is."""

    def test_stale_current_does_not_leave_the_title_on_two_lists(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.watched import Watched

        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        r = client.post("/watch-status/set", json={
            "content_type": "movie", "content_id": 550,
            "target": "Want To Watch", "current": "Currently Watching",
        })

        assert r.status_code == 200
        assert _lists_holding(db, "movie", 550) == {"Want To Watch"}

    def test_removing_works_even_when_client_thinks_it_is_untracked(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.currently_watching import CurrentlyWatching

        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        client.post("/watch-status/set", json={
            "content_type": "movie", "content_id": 550, "target": "none", "current": "none",
        })

        assert _lists_holding(db, "movie", 550) == set()

    def test_a_title_already_on_two_lists_ends_on_the_target_only(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550))
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        client.post("/watch-status/set", json={
            "content_type": "movie", "content_id": 550, "target": "Watched",
            "current": "Watched",
        })

        assert _lists_holding(db, "movie", 550) == {"Watched"}

    def test_moving_a_show_keeps_its_episode_history(self, client, db, seed_users, seed_show):
        from app.models.episode_watched import EpisodeWatched
        from app.models.currently_watching import CurrentlyWatching

        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.add(EpisodeWatched(user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1))
        db.commit()

        client.post("/watch-status/set", json={
            "content_type": "tv", "content_id": 1396, "target": "Want To Watch",
        })

        db.expire_all()
        assert _lists_holding(db, "tv", 1396) == {"Want To Watch"}
        assert db.query(EpisodeWatched).filter_by(user_id="test-uid-1").count() == 1

    @pytest.mark.parametrize("bad_id", [0, -5])
    def test_non_positive_content_id_is_rejected(self, client, db, seed_users, bad_id):
        from app.models.movie import Movie

        r = client.post("/watch-status/set", json={
            "content_type": "movie", "content_id": bad_id, "target": "Want To Watch",
        })

        assert r.status_code == 422
        assert db.query(Movie).filter_by(id=bad_id).first() is None
