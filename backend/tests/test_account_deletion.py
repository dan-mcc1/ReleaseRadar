"""Account deletion (self-service and admin) must only remove the deleted
user's own data. Cached titles are shared, so they stay for
cache_prune_service to decide on, and other users' history is never touched.
An active Stripe subscription is cancelled first so a deleted account is
never billed again."""

from datetime import date
from unittest.mock import patch

import pytest
import stripe
from sqlalchemy import func, select, text

from app.db.base import Base
from app.models.activity import Activity
from app.models.appeal import Appeal
from app.models.banned_email import BannedEmail
from app.models.block import Block
from app.models.collection import Collection
from app.models.community import (
    Community,
    CommunityInvitation,
    CommunityMedia,
    CommunityMember,
    CommunityPost,
    CommunityPostLike,
    CommunityReply,
    CommunityReplyLike,
)
from app.models.currently_watching import CurrentlyWatching
from app.models.device_token import DeviceToken
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.favorite import Favorite
from app.models.feedback import Feedback
from app.models.finish_by_goal import FinishByGoal
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.notification import Notification
from app.models.provider import Provider
from app.models.recommendation import Recommendation
from app.models.report import Report
from app.models.review import Review
from app.models.review_like import ReviewLike
from app.models.rewatch import Rewatch
from app.models.season_rating import SeasonRating
from app.models.sent_episode_alert import SentEpisodeAlert
from app.models.sent_premiere_alert import SentPremiereAlert
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.subscription import Subscription
from app.models.user import User
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.account_service import delete_user_data
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


# --- Every row the user owns goes, whatever the database's foreign keys say ---
#
# The rest of the suite runs on SQLite with foreign-key enforcement off, which
# hid deletes that production's Postgres rejects. These tests turn it on.

A = "test-uid-1"
B = "test-uid-2"


@pytest.fixture
def fk_on(db):
    db.commit()
    db.execute(text("PRAGMA foreign_keys=ON"))
    assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
    yield
    db.rollback()
    db.execute(text("PRAGMA foreign_keys=OFF"))


def _populate(db):
    """Give A (and B, tied to A) a row in every table that can hold a user id.

    When a table with a user column is added, add a row for it here. The guard
    test below then fails until delete_user_data removes it.
    """
    db.add_all([
        User(id=A, username="alice", email="alice@test.com"),
        User(id=B, username="bob", email="bob@test.com"),
        Show(id=1396, name="Breaking Bad", tracking_count=0),
        Movie(id=550, title="Fight Club", tracking_count=0),
        Provider(id=8, name="Netflix"),
        Collection(id=10, name="Collection"),
    ])
    db.flush()
    ep = Episode(id=62085, show_id=1396, season_number=1, episode_number=1)
    shelf_a = Shelf(user_id=A, name="A shelf")
    shelf_b = Shelf(user_id=B, name="B shelf")
    review_a = Review(user_id=A, content_type="movie", content_id=550, review_text="a")
    review_b = Review(user_id=B, content_type="movie", content_id=550, review_text="b")
    community = Community(slug="c", name="C", created_by=A, member_count=2)
    community2 = Community(slug="c2", name="C2", created_by=B)
    friendship = Friendship(requester_id=A, addressee_id=B, status="accepted")
    rec_ab = Recommendation(sender_id=A, recipient_id=B, content_type="movie",
                            content_id=550)
    rec_ba = Recommendation(sender_id=B, recipient_id=A, content_type="movie",
                            content_id=550)
    db.add_all([ep, shelf_a, shelf_b, review_a, review_b, community, community2,
                friendship, rec_ab, rec_ba])
    db.flush()
    # Counters as the app would have stored them before the delete.
    post_a = CommunityPost(community_id=community.id, user_id=A, body="a post",
                           reply_count=2, like_count=1)
    post_b = CommunityPost(community_id=community.id, user_id=B, body="b post",
                           reply_count=2, like_count=1)
    inv_to_a = CommunityInvitation(community_id=community.id, user_id=A,
                                   invited_by=B)
    inv_from_a = CommunityInvitation(community_id=community2.id, user_id=B,
                                     invited_by=A)
    db.add_all([post_a, post_b, inv_to_a, inv_from_a])
    db.flush()
    reply_a = CommunityReply(post_id=post_b.id, user_id=A, body="a reply",
                             like_count=1)
    reply_b = CommunityReply(post_id=post_a.id, user_id=B, body="b reply to a",
                             like_count=1)
    reply_b2 = CommunityReply(post_id=post_b.id, user_id=B, body="b reply",
                              like_count=1)
    reply_a_self = CommunityReply(post_id=post_a.id, user_id=A, body="a self reply")
    db.add_all([reply_a, reply_b, reply_b2, reply_a_self])
    db.flush()
    db.add_all([
        Activity(user_id=A, activity_type="rated", content_type="movie", content_id=550),
        Block(blocker_id=A, blocked_id=B),
        Block(blocker_id=B, blocked_id=A),
        CommunityMember(community_id=community.id, user_id=A, role="owner"),
        CommunityMember(community_id=community.id, user_id=B),
        CommunityMedia(community_id=community.id, content_type="movie",
                       content_id=550, added_by=A),
        CommunityPostLike(post_id=post_a.id, user_id=B),
        CommunityPostLike(post_id=post_b.id, user_id=A),
        CommunityReplyLike(reply_id=reply_a.id, user_id=B),
        CommunityReplyLike(reply_id=reply_b.id, user_id=A),
        CommunityReplyLike(reply_id=reply_b2.id, user_id=A),
        CurrentlyWatching(user_id=A, content_type="tv", content_id=1396),
        DeviceToken(user_id=A, token="tok", platform="ios"),
        EpisodeWatched(user_id=A, show_id=1396, season_number=1, episode_number=1),
        Favorite(user_id=A, content_type="movie", content_id=550),
        Feedback(user_id=A, category="bug", subject="s", description="d"),
        FinishByGoal(user_id=A, show_id=1396, target_date=date(2030, 1, 1)),
        Notification(user_id=A, type="digest", title="t", body="b"),
        Notification(user_id=B, type="recommendation", title="t", body="b",
                     recommendation_id=rec_ab.id),
        Notification(user_id=B, type="friend_request", title="t", body="b",
                     friendship_id=friendship.id),
        Notification(user_id=B, type="community_invite", title="t", body="b",
                     community_invitation_id=inv_from_a.id),
        Report(reporter_id=A, reported_type="user", reported_id=B, reason="r"),
        Report(reporter_id=B, reported_type="user", reported_id=A, reason="r"),
        ReviewLike(user_id=A, review_id=review_b.id),
        ReviewLike(user_id=B, review_id=review_a.id),
        Rewatch(user_id=A, content_type="movie", content_id=550, notes="private"),
        SeasonRating(user_id=A, show_id=1396, season_number=1, rating=4.0),
        SentEpisodeAlert(user_id=A, episode_id=ep.id),
        SentPremiereAlert(user_id=A, show_id=1396, season_number=2, lead_days=7),
        ShelfItem(shelf_id=shelf_a.id, user_id=A, content_type="movie", content_id=550),
        ShelfItem(shelf_id=shelf_b.id, user_id=B, content_type="movie", content_id=550),
        Subscription(user_id=A, status="canceled", source="promo"),
        Appeal(user_id=A, appeal_type="ban", message="please"),
        BannedEmail(email="alice@test.com", user_id=A),
        UserCollectionRanking(user_id=A, collection_id=10, movie_id=550, rank=1),
        UserStreamingService(user_id=A, provider_id=8),
        Watched(user_id=A, content_type="movie", content_id=550),
        Watched(user_id=B, content_type="movie", content_id=550),
        Watchlist(user_id=A, content_type="tv", content_id=1396),
    ])
    db.commit()
    return {"review_b": review_b.id, "post_b": post_b.id, "reply_b2": reply_b2.id,
            "community": community.id, "community2": community2.id}


def _user_fk_columns():
    """Every (table, column) with a foreign key to user.id."""
    return [
        (table, column)
        for table in Base.metadata.sorted_tables
        for column in table.columns
        if any(fk.column.table.name == "user" for fk in column.foreign_keys)
    ]


class TestFullDeletionWithForeignKeys:
    def test_everything_is_deleted_and_the_other_user_is_untouched(
        self, db, fk_on
    ):
        ids = _populate(db)

        delete_user_data(db, A)

        db.expire_all()
        assert db.get(User, A) is None
        assert db.get(User, B) is not None
        # B's own rows survive.
        assert db.get(Review, ids["review_b"]) is not None
        assert db.query(Shelf).filter_by(user_id=B).count() == 1
        assert db.query(ShelfItem).filter_by(user_id=B).count() == 1
        assert db.query(Watched).filter_by(user_id=B).count() == 1
        assert db.get(CommunityPost, ids["post_b"]) is not None
        # B's reply to A's post goes with that post; B's other reply stays.
        assert db.query(CommunityReply).filter_by(user_id=B).count() == 1
        # B's inbox keeps nothing that points at rows removed with A. The
        # invitation A sent stays (inviter set to NULL), and so does its alert.
        assert [n.type for n in db.query(Notification).filter_by(user_id=B)] == [
            "community_invite"
        ]

    def test_no_row_still_holds_the_deleted_users_id(self, db, fk_on):
        # Walks the metadata, so a table added later with a user foreign key
        # and no delete in delete_user_data fails here once _populate gives it
        # a row for A.
        _populate(db)

        delete_user_data(db, A)

        db.expire_all()
        for table, column in _user_fk_columns():
            left = db.execute(
                select(func.count()).select_from(table).where(column == A)
            ).scalar()
            assert left == 0, f"{table.name}.{column.name} still holds the user"
        # Tables with a user_id column but no foreign key are covered too.
        # banned_email is kept on purpose: a ban must outlive the account.
        kept = {"banned_email"}
        for table in Base.metadata.sorted_tables:
            if "user_id" in table.columns and table.name not in kept:
                left = db.execute(
                    select(func.count()).select_from(table)
                    .where(table.c.user_id == A)
                ).scalar()
                assert left == 0, f"{table.name}.user_id still holds the user"
        for model in (Rewatch, Subscription, Appeal):
            assert db.query(model).filter_by(user_id=A).count() == 0

    def test_set_null_columns_keep_their_rows(self, db, fk_on):
        ids = _populate(db)

        delete_user_data(db, A)

        db.expire_all()
        community = db.get(Community, ids["community"])
        assert community is not None and community.created_by is None
        assert db.query(CommunityMedia).one().added_by is None
        assert db.query(Feedback).one().user_id is None
        reports = {r.reported_id: r for r in db.query(Report)}
        assert reports[B].reporter_id is None
        invitation = (
            db.query(CommunityInvitation)
            .filter_by(community_id=ids["community2"])
            .one()
        )
        assert invitation.invited_by is None

    def test_bans_and_reports_about_the_user_outlive_the_account(self, db, fk_on):
        _populate(db)

        delete_user_data(db, A)

        db.expire_all()
        assert db.query(BannedEmail).filter_by(user_id=A).count() == 1
        assert db.query(Report).filter_by(reported_id=A).count() == 1


class TestStoredCounters:
    def test_counters_on_other_users_content_are_recounted(self, db, fk_on):
        ids = _populate(db)

        delete_user_data(db, A)

        db.expire_all()
        assert db.get(Community, ids["community"]).member_count == 1
        post_b = db.get(CommunityPost, ids["post_b"])
        assert post_b.reply_count == 1  # B's own reply; A's is gone
        assert post_b.like_count == 0  # A's like is gone
        assert db.get(CommunityReply, ids["reply_b2"]).like_count == 0

    def test_counters_that_were_already_wrong_are_healed(self, db, fk_on):
        ids = _populate(db)
        db.query(Community).filter_by(id=ids["community"]).update({"member_count": 7})
        db.query(CommunityPost).filter_by(id=ids["post_b"]).update(
            {"reply_count": 0, "like_count": 9}
        )
        db.commit()

        delete_user_data(db, A)

        db.expire_all()
        assert db.get(Community, ids["community"]).member_count == 1
        post_b = db.get(CommunityPost, ids["post_b"])
        assert (post_b.reply_count, post_b.like_count) == (1, 0)


class TestAdminModerationDelete:
    def test_delete_user_report_removes_data_and_firebase_account(
        self, db, fk_on, admin_client
    ):
        _populate(db)
        db.add(Report(reporter_id=B, reported_type="user", reported_id=A,
                      reason="abuse"))
        db.commit()
        report_id = (
            db.query(Report).filter_by(reporter_id=B, reason="abuse").one().id
        )

        with patch("app.routers.admin.auth.delete_user") as firebase_delete:
            r = admin_client.post(
                f"/admin/reports/{report_id}/accept", json={"action": "delete_user"}
            )

        assert r.status_code == 200, r.text
        firebase_delete.assert_called_once_with(A)
        db.expire_all()
        assert db.get(User, A) is None
        assert db.query(Recommendation).filter(
            (Recommendation.sender_id == A) | (Recommendation.recipient_id == A)
        ).count() == 0
        assert db.query(ReviewLike).filter_by(user_id=A).count() == 0
        assert db.get(Report, report_id).status == "accepted"

    def test_firebase_failure_does_not_strand_the_report(
        self, db, fk_on, admin_client, caplog
    ):
        _populate(db)
        db.add(Report(reporter_id=B, reported_type="user", reported_id=A,
                      reason="abuse"))
        db.commit()
        report_id = (
            db.query(Report).filter_by(reporter_id=B, reason="abuse").one().id
        )

        # firebase_admin.auth is a MagicMock in tests; give the except clause
        # a real exception class to compare against.
        with patch("app.routers.admin.auth.UserNotFoundError", KeyError):
            with patch("app.routers.admin.auth.delete_user",
                       side_effect=RuntimeError("firebase down")):
                r = admin_client.post(
                    f"/admin/reports/{report_id}/accept",
                    json={"action": "delete_user"},
                )

        assert r.status_code == 200, r.text
        db.expire_all()
        assert db.get(User, A) is None
        assert db.get(Report, report_id).status == "accepted"
        assert any(
            rec.levelname == "ERROR" and A in rec.getMessage()
            for rec in caplog.records
        )
