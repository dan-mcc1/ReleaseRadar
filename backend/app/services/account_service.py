"""Deleting a user account (self-service and admin)."""

from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.activity import Activity
from app.models.block import Block
from app.models.currently_watching import CurrentlyWatching
from app.models.episode_watched import EpisodeWatched
from app.models.favorite import Favorite
from app.models.report import Report
from app.models.review import Review
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.user import User
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.billing_service import cancel_subscription_immediately
from app.services.media_upsert import recount_tracking


def delete_user_data(db: Session, user_id: str) -> None:
    """Remove one user's data and their User row, then commit.

    Only the user's own rows are touched. Cached Show/Movie rows are shared,
    so they stay — cache_prune_service removes titles nothing references.
    Any Stripe subscription is cancelled first; if that fails this raises
    before anything is deleted.
    """
    cancel_subscription_immediately(db, user_id)

    tracked: dict[str, set[int]] = defaultdict(set)
    for model in (Watchlist, CurrentlyWatching, Watched):
        for content_type, content_id in (
            db.query(model.content_type, model.content_id).filter(model.user_id == user_id)
        ):
            tracked[content_type].add(content_id)

    db.query(ShelfItem).filter(ShelfItem.user_id == user_id).delete()
    db.query(Shelf).filter(Shelf.user_id == user_id).delete()
    db.query(Review).filter(Review.user_id == user_id).delete()
    db.query(Favorite).filter(Favorite.user_id == user_id).delete()
    db.query(Activity).filter(Activity.user_id == user_id).delete()
    db.query(EpisodeWatched).filter(EpisodeWatched.user_id == user_id).delete()
    db.query(CurrentlyWatching).filter(CurrentlyWatching.user_id == user_id).delete()
    db.query(Watched).filter(Watched.user_id == user_id).delete()
    db.query(Watchlist).filter(Watchlist.user_id == user_id).delete()
    db.query(Block).filter(
        (Block.blocker_id == user_id) | (Block.blocked_id == user_id)
    ).delete(synchronize_session=False)
    db.query(Report).filter(Report.reporter_id == user_id).update(
        {Report.reporter_id: None}, synchronize_session=False
    )

    for content_type, ids in tracked.items():
        recount_tracking(db, content_type, ids)

    user = db.get(User, user_id)
    if user:
        db.delete(user)
    db.commit()
