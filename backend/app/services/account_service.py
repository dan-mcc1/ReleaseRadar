"""Deleting a user account (self-service and admin)."""

from collections import defaultdict

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.appeal import Appeal
from app.models.block import Block
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
from app.models.episode_watched import EpisodeWatched
from app.models.favorite import Favorite
from app.models.feedback import Feedback
from app.models.finish_by_goal import FinishByGoal
from app.models.friendship import Friendship
from app.models.notification import Notification
from app.models.recommendation import Recommendation
from app.models.report import Report
from app.models.review import Review
from app.models.review_like import ReviewLike
from app.models.rewatch import Rewatch
from app.models.season_rating import SeasonRating
from app.models.sent_episode_alert import SentEpisodeAlert
from app.models.sent_premiere_alert import SentPremiereAlert
from app.models.sent_resume_reminder import SentResumeReminder
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.subscription import Subscription
from app.models.user import User
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.billing_service import cancel_subscription_immediately
from app.services.media_upsert import recount_tracking


def delete_user_data(db: Session, user_id: str) -> None:
    """Remove one user's data and their User row, then commit.

    Every row the user owns is deleted here by hand, children before parents.
    Production's foreign keys don't match the models (it was altered by hand
    before Alembic), so nothing relies on ON DELETE rules. Columns the models
    declare ON DELETE SET NULL are nulled (community creator, media adder,
    inviter, feedback author, report reporter). Left alone on purpose: bans
    (they must outlive the account) and reports about the user.

    Cached Show/Movie rows are shared, so they stay: cache_prune_service
    removes titles nothing references. Any Stripe subscription is cancelled
    first; if that fails this raises before anything is deleted.
    """
    cancel_subscription_immediately(db, user_id)
    # The cancel marks the subscription row dirty; write that before it is purged.
    db.flush()

    tracked: dict[str, set[int]] = defaultdict(set)
    for model in (Watchlist, CurrentlyWatching, Watched):
        for content_type, content_id in (
            db.query(model.content_type, model.content_id).filter(model.user_id == user_id)
        ):
            tracked[content_type].add(content_id)

    # Content of other users that the user joined, replied to or liked: its
    # stored counters are recounted once the user's rows are gone. Posts and
    # replies deleted below simply match nothing.
    def ids(column, *conditions) -> list[int]:
        return list(db.execute(select(column).where(*conditions)).scalars())

    joined_communities = ids(
        CommunityMember.community_id, CommunityMember.user_id == user_id
    )
    touched_posts = ids(
        CommunityReply.post_id, CommunityReply.user_id == user_id
    ) + ids(CommunityPostLike.post_id, CommunityPostLike.user_id == user_id)
    liked_replies = ids(
        CommunityReplyLike.reply_id, CommunityReplyLike.user_id == user_id
    )

    def purge(model, *conditions) -> None:
        db.query(model).filter(*conditions).delete(synchronize_session=False)

    # Social rows. Inbox notifications that point at a row go before that row.
    recommendations = select(Recommendation.id).where(
        or_(Recommendation.sender_id == user_id, Recommendation.recipient_id == user_id)
    )
    friendships = select(Friendship.id).where(
        or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id)
    )
    invitations = select(CommunityInvitation.id).where(
        CommunityInvitation.user_id == user_id
    )
    purge(
        Notification,
        or_(
            Notification.user_id == user_id,
            Notification.recommendation_id.in_(recommendations),
            Notification.friendship_id.in_(friendships),
            Notification.community_invitation_id.in_(invitations),
        ),
    )
    purge(Recommendation, Recommendation.id.in_(recommendations))
    purge(Friendship, Friendship.id.in_(friendships))
    purge(Block, or_(Block.blocker_id == user_id, Block.blocked_id == user_id))

    # Community activity. Replies and likes on the user's posts and likes on
    # the user's replies go before the posts and replies themselves.
    own_posts = select(CommunityPost.id).where(CommunityPost.user_id == user_id)
    doomed_replies = select(CommunityReply.id).where(
        or_(CommunityReply.user_id == user_id, CommunityReply.post_id.in_(own_posts))
    )
    purge(
        CommunityReplyLike,
        or_(
            CommunityReplyLike.user_id == user_id,
            CommunityReplyLike.reply_id.in_(doomed_replies),
        ),
    )
    purge(CommunityReply, CommunityReply.id.in_(doomed_replies))
    purge(
        CommunityPostLike,
        or_(
            CommunityPostLike.user_id == user_id,
            CommunityPostLike.post_id.in_(own_posts),
        ),
    )
    purge(CommunityPost, CommunityPost.user_id == user_id)
    purge(CommunityInvitation, CommunityInvitation.user_id == user_id)
    purge(CommunityMember, CommunityMember.user_id == user_id)
    for model, column in (
        (Community, Community.created_by),
        (CommunityMedia, CommunityMedia.added_by),
        (CommunityInvitation, CommunityInvitation.invited_by),
        (Feedback, Feedback.user_id),
        (Report, Report.reporter_id),
    ):
        db.query(model).filter(column == user_id).update(
            {column: None}, synchronize_session=False
        )

    # Reviews, with the likes on them.
    purge(
        ReviewLike,
        or_(
            ReviewLike.user_id == user_id,
            ReviewLike.review_id.in_(select(Review.id).where(Review.user_id == user_id)),
        ),
    )
    purge(Review, Review.user_id == user_id)

    # Lists and history.
    purge(ShelfItem, ShelfItem.user_id == user_id)
    purge(Shelf, Shelf.user_id == user_id)
    purge(Favorite, Favorite.user_id == user_id)
    purge(Activity, Activity.user_id == user_id)
    purge(EpisodeWatched, EpisodeWatched.user_id == user_id)
    purge(CurrentlyWatching, CurrentlyWatching.user_id == user_id)
    purge(Watched, Watched.user_id == user_id)
    purge(Watchlist, Watchlist.user_id == user_id)
    purge(Rewatch, Rewatch.user_id == user_id)
    purge(SeasonRating, SeasonRating.user_id == user_id)
    purge(FinishByGoal, FinishByGoal.user_id == user_id)
    purge(UserCollectionRanking, UserCollectionRanking.user_id == user_id)

    # Settings, devices, alert records, billing and appeals.
    purge(UserStreamingService, UserStreamingService.user_id == user_id)
    purge(DeviceToken, DeviceToken.user_id == user_id)
    purge(SentPremiereAlert, SentPremiereAlert.user_id == user_id)
    purge(SentResumeReminder, SentResumeReminder.user_id == user_id)
    purge(SentEpisodeAlert, SentEpisodeAlert.user_id == user_id)
    purge(Subscription, Subscription.user_id == user_id)
    purge(Appeal, Appeal.user_id == user_id)

    # Recounted from the remaining rows, as the community service defines them.
    db.flush()
    if joined_communities:
        db.execute(
            update(Community)
            .where(Community.id.in_(joined_communities))
            .values(
                member_count=select(func.count())
                .select_from(CommunityMember)
                .where(CommunityMember.community_id == Community.id)
                .scalar_subquery()
            )
            .execution_options(synchronize_session=False)
        )
    if touched_posts:
        db.execute(
            update(CommunityPost)
            .where(CommunityPost.id.in_(touched_posts))
            .values(
                reply_count=select(func.count())
                .select_from(CommunityReply)
                .where(CommunityReply.post_id == CommunityPost.id)
                .scalar_subquery(),
                like_count=select(func.count())
                .select_from(CommunityPostLike)
                .where(CommunityPostLike.post_id == CommunityPost.id)
                .scalar_subquery(),
            )
            .execution_options(synchronize_session=False)
        )
    if liked_replies:
        db.execute(
            update(CommunityReply)
            .where(CommunityReply.id.in_(liked_replies))
            .values(
                like_count=select(func.count())
                .select_from(CommunityReplyLike)
                .where(CommunityReplyLike.reply_id == CommunityReply.id)
                .scalar_subquery()
            )
            .execution_options(synchronize_session=False)
        )

    for content_type, content_ids in tracked.items():
        recount_tracking(db, content_type, content_ids)

    user = db.get(User, user_id)
    if user:
        db.delete(user)
    db.commit()
