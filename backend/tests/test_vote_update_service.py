"""
Tests for app.services.vote_update_service.

Covers the periodic vote_average refresh for tracked shows/movies.
TMDb HTTP fetches are mocked via app.services.tmdb_client.get.
"""

from datetime import date
from unittest.mock import patch

import pytest


@pytest.fixture
def seed_user(db):
    from app.models.user import User

    u = User(id="vote-user", username="voter", email="voter@test.com")
    db.add(u)
    db.commit()
    return u


def _make_show(db, sid: int, vote: float = 5.0):
    from app.models.show import Show

    db.add(
        Show(
            id=sid,
            name=f"Show {sid}",
            first_air_date=date(2020, 1, 1),
            number_of_seasons=1,
            number_of_episodes=10,
            tracking_count=1,
            vote_average=vote,
        )
    )
    db.commit()


def _make_movie(db, mid: int, vote: float = 5.0):
    from app.models.movie import Movie

    db.add(
        Movie(
            id=mid,
            title=f"Movie {mid}",
            release_date=date(2020, 1, 1),
            runtime=100,
            tracking_count=1,
            vote_average=vote,
        )
    )
    db.commit()


class TestUpdateAllVoteAverages:
    def test_no_tracked_content_is_a_no_op(self, db, seed_user):
        from app.services.vote_update_service import update_all_vote_averages

        with patch("app.services.vote_update_service.get") as mock_get:
            update_all_vote_averages(db)
        # No TMDb call should be made when there's nothing tracked
        assert mock_get.call_count == 0

    def test_updates_show_vote_average_when_tracked(self, db, seed_user):
        from app.models.show import Show
        from app.models.watchlist import Watchlist
        from app.services.vote_update_service import update_all_vote_averages

        _make_show(db, 100, vote=4.0)
        db.add(
            Watchlist(user_id="vote-user", content_type="tv", content_id=100)
        )
        db.commit()

        with patch(
            "app.services.vote_update_service.get",
            return_value={"vote_average": 8.7},
        ):
            update_all_vote_averages(db)

        db.expire_all()
        s = db.query(Show).filter_by(id=100).first()
        assert s.vote_average == 8.7

    def test_updates_movie_vote_average_when_tracked(self, db, seed_user):
        from app.models.movie import Movie
        from app.models.watched import Watched
        from app.services.vote_update_service import update_all_vote_averages

        _make_movie(db, 200, vote=3.0)
        db.add(
            Watched(user_id="vote-user", content_type="movie", content_id=200)
        )
        db.commit()

        with patch(
            "app.services.vote_update_service.get",
            return_value={"vote_average": 9.1},
        ):
            update_all_vote_averages(db)

        db.expire_all()
        m = db.query(Movie).filter_by(id=200).first()
        assert m.vote_average == 9.1

    def test_skip_when_tmdb_returns_no_vote(self, db, seed_user):
        from app.models.show import Show
        from app.models.watchlist import Watchlist
        from app.services.vote_update_service import update_all_vote_averages

        _make_show(db, 101, vote=5.5)
        db.add(
            Watchlist(user_id="vote-user", content_type="tv", content_id=101)
        )
        db.commit()

        with patch(
            "app.services.vote_update_service.get",
            return_value={},  # no vote_average key
        ):
            update_all_vote_averages(db)

        db.expire_all()
        s = db.query(Show).filter_by(id=101).first()
        # No update applied → original retained
        assert s.vote_average == 5.5

    def test_tmdb_exception_is_swallowed(self, db, seed_user):
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist
        from app.services.vote_update_service import update_all_vote_averages

        _make_movie(db, 201, vote=6.0)
        db.add(
            Watchlist(user_id="vote-user", content_type="movie", content_id=201)
        )
        db.commit()

        def _boom(_path):
            raise RuntimeError("TMDb down")

        with patch("app.services.vote_update_service.get", side_effect=_boom):
            # Should not raise
            update_all_vote_averages(db)

        db.expire_all()
        m = db.query(Movie).filter_by(id=201).first()
        assert m.vote_average == 6.0

    def test_tracked_ids_dedupes_across_lists(self, db, seed_user):
        """A show present in Watchlist + CurrentlyWatching + Watched should only
        be fetched once."""
        from app.models.currently_watching import CurrentlyWatching
        from app.models.show import Show
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist
        from app.services.vote_update_service import update_all_vote_averages

        _make_show(db, 300, vote=2.0)
        db.add(Watchlist(user_id="vote-user", content_type="tv", content_id=300))
        db.add(
            CurrentlyWatching(
                user_id="vote-user", content_type="tv", content_id=300
            )
        )
        db.add(Watched(user_id="vote-user", content_type="tv", content_id=300))
        db.commit()

        with patch(
            "app.services.vote_update_service.get",
            return_value={"vote_average": 7.0},
        ) as mock_get:
            update_all_vote_averages(db)

        # Exactly one TMDb call for the deduped id
        assert mock_get.call_count == 1
        db.expire_all()
        assert db.query(Show).filter_by(id=300).first().vote_average == 7.0

    def test_mixed_shows_and_movies_both_updated(self, db, seed_user):
        from app.models.movie import Movie
        from app.models.show import Show
        from app.models.watchlist import Watchlist
        from app.services.vote_update_service import update_all_vote_averages

        _make_show(db, 400, vote=1.0)
        _make_movie(db, 500, vote=1.0)
        db.add(Watchlist(user_id="vote-user", content_type="tv", content_id=400))
        db.add(
            Watchlist(user_id="vote-user", content_type="movie", content_id=500)
        )
        db.commit()

        def _fake(path):
            if path.startswith("/tv/"):
                return {"vote_average": 9.0}
            return {"vote_average": 8.0}

        with patch("app.services.vote_update_service.get", side_effect=_fake):
            update_all_vote_averages(db)

        db.expire_all()
        assert db.query(Show).filter_by(id=400).first().vote_average == 9.0
        assert db.query(Movie).filter_by(id=500).first().vote_average == 8.0
