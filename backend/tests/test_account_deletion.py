"""Account deletion (self-service and admin) must only remove the deleted
user's own data. Cached titles are shared, so they stay for
cache_prune_service to decide on, and other users' history is never touched.
An active Stripe subscription is cancelled first so a deleted account is
never billed again."""

from unittest.mock import patch

import pytest
import stripe

from app.models.currently_watching import CurrentlyWatching
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.show import Show
from app.models.subscription import Subscription
from app.models.user import User
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from tests.conftest import make_client


@pytest.fixture
def admin_client(db):
    db.add(User(id="admin-uid", username="admin", email="a@test.com",
                subscription_tier="admin"))
    db.commit()
    return make_client("admin-uid")


def _delete_self(client):
    return client.delete("/user/account")


def _delete_by_admin(admin_client):
    return admin_client.delete("/admin/users/test-uid-1")


@pytest.fixture(params=["self", "admin"])
def delete_user_1(request, client):
    """Run the same expectations against both deletion endpoints."""
    if request.param == "self":
        return lambda: _delete_self(client)
    admin = request.getfixturevalue("admin_client")
    return lambda: _delete_by_admin(admin)


class TestSharedDataSurvives:
    def test_other_users_episode_history_survives_even_when_count_drifted(
        self, db, seed_users, seed_show, delete_user_1
    ):
        # The seeded show says tracking_count=0 even though both users track
        # it — the drift that used to make deletion wipe user-2's history.
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.add(Watched(user_id="test-uid-2", content_type="tv", content_id=1396))
        db.add(EpisodeWatched(user_id="test-uid-2", show_id=1396,
                              season_number=1, episode_number=1))
        db.commit()

        assert delete_user_1().status_code == 200

        db.expire_all()
        assert db.query(Show).filter_by(id=1396).first() is not None
        assert db.query(EpisodeWatched).filter_by(user_id="test-uid-2").count() == 1

    def test_title_only_the_deleted_user_tracked_stays_cached(
        self, db, seed_users, seed_movie, delete_user_1
    ):
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        assert delete_user_1().status_code == 200

        db.expire_all()
        movie = db.query(Movie).filter_by(id=550).first()
        assert movie is not None
        assert movie.tracking_count == 0


class TestTrackingRecount:
    def test_counts_are_recomputed_from_remaining_lists(
        self, db, seed_users, seed_movie, delete_user_1
    ):
        # Currently Watching used to be skipped entirely on deletion.
        db.query(Movie).filter_by(id=550).update({"tracking_count": 7})
        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="movie",
                                 content_id=550))
        db.add(Watched(user_id="test-uid-2", content_type="movie", content_id=550))
        db.commit()

        assert delete_user_1().status_code == 200

        db.expire_all()
        assert db.query(Movie).filter_by(id=550).one().tracking_count == 1


class TestStripeCancellation:
    def _subscribe(self, db, status="active"):
        db.add(Subscription(user_id="test-uid-1", status=status, source="stripe",
                            stripe_customer_id="cus_1",
                            stripe_subscription_id="sub_123"))
        db.commit()

    def test_active_subscription_is_cancelled(self, db, seed_users, delete_user_1):
        self._subscribe(db)
        with patch("stripe.Subscription.cancel") as cancel:
            assert delete_user_1().status_code == 200
        cancel.assert_called_once_with("sub_123")

    def test_already_canceled_subscription_is_not_cancelled_again(
        self, db, seed_users, delete_user_1
    ):
        self._subscribe(db, status="canceled")
        with patch("stripe.Subscription.cancel") as cancel:
            assert delete_user_1().status_code == 200
        cancel.assert_not_called()

    def test_stripe_outage_aborts_deletion(self, db, seed_users, delete_user_1):
        self._subscribe(db)
        with patch("stripe.Subscription.cancel",
                   side_effect=stripe.APIConnectionError("down")):
            r = delete_user_1()
        assert r.status_code == 502
        db.expire_all()
        assert db.query(User).filter_by(id="test-uid-1").first() is not None

    def test_subscription_missing_on_stripe_does_not_block_deletion(
        self, db, seed_users, delete_user_1
    ):
        self._subscribe(db)
        missing = stripe.InvalidRequestError(
            "No such subscription: 'sub_123'", param="id", code="resource_missing"
        )
        with patch("stripe.Subscription.cancel", side_effect=missing):
            assert delete_user_1().status_code == 200
        db.expire_all()
        assert db.query(User).filter_by(id="test-uid-1").first() is None
