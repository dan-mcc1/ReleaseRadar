from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import datetime, timedelta
from app.models.activity import Activity
from app.models.friendship import Friendship
from app.models.user import User


def delete_old_activity(db: Session, days: int = 7) -> int:
    cutoff = datetime.utcnow() - timedelta(days=days)
    deleted = db.query(Activity).filter(Activity.created_at < cutoff).delete()
    db.commit()
    return deleted


def log_activity(
    db: Session,
    user_id: str,
    activity_type: str,
    content_type: str,
    content_id: int,
    content_title: str = None,
    content_poster_path: str = None,
    rating: float = None,
    season_number: int = None,
    episode_number: int = None,
):
    # Remove any existing entry for the same user/type/content so re-adding
    # a show doesn't accumulate duplicate activity rows.
    q = db.query(Activity).filter(
        Activity.user_id == user_id,
        Activity.activity_type == activity_type,
        Activity.content_type == content_type,
        Activity.content_id == content_id,
    )
    if activity_type == "episode_watched":
        q = q.filter(
            Activity.season_number == season_number,
            Activity.episode_number == episode_number,
        )
    q.delete()

    entry = Activity(
        user_id=user_id,
        activity_type=activity_type,
        content_type=content_type,
        content_id=content_id,
        content_title=content_title,
        content_poster_path=content_poster_path,
        rating=rating,
        season_number=season_number,
        episode_number=episode_number,
    )
    db.add(entry)
    db.flush()


def _serialize_activity(a: Activity, username: str) -> dict:
    return {
        "id": a.id,
        "user_id": a.user_id,
        "username": username,
        "activity_type": a.activity_type,
        "content_type": a.content_type,
        "content_id": a.content_id,
        "content_title": a.content_title,
        "content_poster_path": a.content_poster_path,
        "rating": a.rating,
        "season_number": a.season_number,
        "episode_number": a.episode_number,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _visible_friend_ids(db: Session, user_id: str) -> list[str]:
    """
    Return the IDs of accepted friends whose profile_visibility is not "private".
    Private users' activity is hidden from the feed.
    """
    friendships = (
        db.query(Friendship)
        .filter(
            or_(
                Friendship.requester_id == user_id,
                Friendship.addressee_id == user_id,
            ),
            Friendship.status == "accepted",
        )
        .all()
    )
    friend_ids = [
        f.addressee_id if f.requester_id == user_id else f.requester_id
        for f in friendships
    ]
    if not friend_ids:
        return []
    # Exclude friends who have set their profile to private
    visible = (
        db.query(User.id)
        .filter(
            User.id.in_(friend_ids),
            User.profile_visibility != "private",
        )
        .all()
    )
    return [row.id for row in visible]


def get_my_activity(db: Session, user_id: str, limit: int = 50) -> list:
    """Returns only the current user's own activity, newest first."""
    rows = (
        db.query(Activity, User.username)
        .join(User, User.id == Activity.user_id)
        .filter(Activity.user_id == user_id)
        .order_by(Activity.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_activity(a, username) for a, username in rows]


def get_activity_feed(db: Session, user_id: str, limit: int = 50) -> list:
    """
    Returns own activity + accepted friends' (non-private) activity, newest first.
    """
    friend_ids = _visible_friend_ids(db, user_id)
    visible_ids = [user_id] + friend_ids

    rows = (
        db.query(Activity, User.username)
        .join(User, User.id == Activity.user_id)
        .filter(Activity.user_id.in_(visible_ids))
        .order_by(Activity.created_at.desc())
        .limit(limit)
        .all()
    )

    return [_serialize_activity(a, username) for a, username in rows]


def get_friends_activity(db: Session, user_id: str, limit: int = 30) -> list:
    """Friends-only feed (used internally), excludes private profiles."""
    friend_ids = _visible_friend_ids(db, user_id)

    if not friend_ids:
        return []

    rows = (
        db.query(Activity, User.username)
        .join(User, User.id == Activity.user_id)
        .filter(Activity.user_id.in_(friend_ids))
        .order_by(Activity.created_at.desc())
        .limit(limit)
        .all()
    )

    return [_serialize_activity(a, username) for a, username in rows]
