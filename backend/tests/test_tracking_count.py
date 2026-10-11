"""tracking_count is the number of distinct users with a title on any list
(Watchlist, Currently Watching, Watched). It is recomputed from those rows
whenever a list changes, so a drifted value corrects itself on the next
change instead of being carried forward by +1/-1 arithmetic."""

from app.models.movie import Movie
from app.models.show import Show
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.currently_watching_service import (
    add_to_currently_watching,
    remove_from_currently_watching,
)
from app.services.watched_service import add_to_watched, remove_from_watched
from app.services.watchlist_service import add_to_watchlist, remove_from_watchlist


def _count(db, model, content_id):
    db.expire_all()
    return db.query(model).filter_by(id=content_id).one().tracking_count


class TestRecountOnAdd:
    def test_watchlist_add_replaces_a_drifted_count(self, db, seed_users, seed_movie):
        db.query(Movie).filter_by(id=550).update({"tracking_count": 5})
        db.commit()

        add_to_watchlist(db, "test-uid-1", "movie", 550)

        assert _count(db, Movie, 550) == 1

    def test_new_stub_counts_its_first_tracker(self, db, seed_users):
        add_to_currently_watching(db, "test-uid-1", "tv", 4242)

        assert _count(db, Show, 4242) == 1

    def test_second_user_adds_one(self, db, seed_users, seed_movie):
        add_to_watched(db, "test-uid-1", "movie", 550)
        add_to_watchlist(db, "test-uid-2", "movie", 550)

        assert _count(db, Movie, 550) == 2

    def test_user_on_two_lists_counts_once(self, db, seed_users, seed_movie):
        add_to_watchlist(db, "test-uid-1", "movie", 550)
        add_to_watched(db, "test-uid-1", "movie", 550)

        assert _count(db, Movie, 550) == 1


class TestRecountOnRemove:
    def test_remove_restores_a_count_drifted_to_zero(self, db, seed_users, seed_movie):
        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550))
        db.add(Watched(user_id="test-uid-2", content_type="movie", content_id=550))
        db.commit()  # seed_movie still says tracking_count=0

        remove_from_watchlist(db, "test-uid-1", "movie", 550)

        assert _count(db, Movie, 550) == 1

    def test_last_tracker_leaving_reaches_zero(self, db, seed_users, seed_show):
        add_to_currently_watching(db, "test-uid-1", "tv", 1396)
        remove_from_currently_watching(db, "test-uid-1", "tv", 1396)

        assert _count(db, Show, 1396) == 0

    def test_watched_remove_recounts(self, db, seed_users, seed_movie):
        add_to_watched(db, "test-uid-1", "movie", 550)
        add_to_watched(db, "test-uid-2", "movie", 550)
        remove_from_watched(db, "test-uid-1", "movie", 550)

        assert _count(db, Movie, 550) == 1


class TestStubDoesNotHidePendingPopulate:
    def test_second_tracker_leaves_stub_marked_unpopulated(self, db, seed_users):
        # populate_*_bg skips rows whose updated_at is set; a second user
        # adding the title before population ran used to set it.
        add_to_watchlist(db, "test-uid-1", "movie", 4243)
        add_to_watchlist(db, "test-uid-2", "movie", 4243)

        db.expire_all()
        assert db.query(Movie).filter_by(id=4243).one().updated_at is None
