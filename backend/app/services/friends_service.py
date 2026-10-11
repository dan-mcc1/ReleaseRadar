# app/services/friends_service.py
import threading
from datetime import datetime, timezone, timedelta

from cachetools import TTLCache
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, bindparam, func, literal, null, union_all, text, update
from fastapi import HTTPException

from app.models.friendship import Friendship
from app.models.notification import Notification
from app.models.user import User
from app.models.block import Block
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching

# Configurable limits
MAX_PENDING_OUTGOING = 25
DECLINED_COOLDOWN_DAYS = 30
REQUEST_TARGET_COOLDOWN_MINUTES = 60


def _utcnow():
    return datetime.now(timezone.utc)


def _serialize_user(user: User) -> dict:
    return {"id": user.id, "username": user.username, "display_name": user.display_name}


def _get_friendship(db: Session, user_a: str, user_b: str) -> Friendship | None:
    """Return the friendship row between two users in either direction."""
    return (
        db.query(Friendship)
        .filter(
            or_(
                and_(
                    Friendship.requester_id == user_a, Friendship.addressee_id == user_b
                ),
                and_(
                    Friendship.requester_id == user_b, Friendship.addressee_id == user_a
                ),
            )
        )
        .first()
    )


def send_friend_request(db: Session, requester_id: str, addressee_username: str, message: str | None = None):
    """
    Send a friend request to a user identified by username.
    If the target's profile is public, the friendship is auto-accepted immediately.
    """
    if not addressee_username:
        raise HTTPException(status_code=422, detail="Username is required.")

    addressee = db.query(User).filter(User.username == addressee_username).first()
    if not addressee:
        raise HTTPException(status_code=404, detail="User not found.")

    if addressee.id == requester_id:
        raise HTTPException(
            status_code=400, detail="You cannot send a friend request to yourself."
        )

    # Block check: either party has blocked the other
    block = (
        db.query(Block)
        .filter(
            or_(
                and_(Block.blocker_id == requester_id, Block.blocked_id == addressee.id),
                and_(Block.blocker_id == addressee.id, Block.blocked_id == requester_id),
            )
        )
        .first()
    )
    if block:
        raise HTTPException(status_code=403, detail="User not found.")

    is_public = (addressee.profile_visibility or "friends_only") == "public"

    existing = _get_friendship(db, requester_id, addressee.id)

    if existing:
        if existing.status == "accepted":
            raise HTTPException(status_code=409, detail="You are already friends.")
        if existing.status == "following":
            if existing.requester_id == requester_id:
                # Requester is already following this person
                raise HTTPException(
                    status_code=409, detail="You are already following this user."
                )
            else:
                # The target is already following the requester — add back → mutual friends
                existing.status = "accepted"
                existing.updated_at = _utcnow()
                db.commit()
                db.refresh(existing)
                return existing
        if existing.status == "pending":
            if existing.requester_id != requester_id:
                # The other person already sent a request — auto-accept it
                existing.status = "accepted"
                existing.updated_at = _utcnow()
                db.commit()
                db.refresh(existing)
                return existing
            raise HTTPException(
                status_code=409, detail="A friend request already exists between you."
            )
        if existing.status == "declined":
            cooldown_end = existing.updated_at.replace(tzinfo=timezone.utc) + timedelta(
                days=DECLINED_COOLDOWN_DAYS
            )
            if _utcnow() < cooldown_end:
                days_left = (cooldown_end - _utcnow()).days + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"This request was declined. You may try again in {days_left} day(s).",
                )
            # Cooldown passed — reuse the row, reset it
            existing.requester_id = requester_id
            existing.addressee_id = addressee.id
            existing.status = "following" if is_public else "pending"
            existing.message = message if not is_public else None
            existing.updated_at = _utcnow()
            db.commit()
            db.refresh(existing)
            return existing
        if existing.status == "withdrawn":
            cooldown_end = existing.updated_at.replace(tzinfo=timezone.utc) + timedelta(
                minutes=REQUEST_TARGET_COOLDOWN_MINUTES
            )
            if _utcnow() < cooldown_end:
                minutes_left = max(1, int((cooldown_end - _utcnow()).total_seconds() // 60))
                raise HTTPException(
                    status_code=429,
                    detail=f"You recently cancelled a request to this user. Try again in {minutes_left} minute(s).",
                )
            # Cooldown passed — reuse the row, reset it
            existing.requester_id = requester_id
            existing.addressee_id = addressee.id
            existing.status = "following" if is_public else "pending"
            existing.message = message if not is_public else None
            existing.updated_at = _utcnow()
            db.commit()
            db.refresh(existing)
            return existing

    # Check outgoing pending limit (only applies to actual pending requests)
    if not is_public:
        pending_count = (
            db.query(Friendship)
            .filter(
                Friendship.requester_id == requester_id, Friendship.status == "pending"
            )
            .count()
        )
        if pending_count >= MAX_PENDING_OUTGOING:
            raise HTTPException(
                status_code=429,
                detail=f"You have reached the limit of {MAX_PENDING_OUTGOING} pending friend requests.",
            )

    friendship = Friendship(
        requester_id=requester_id,
        addressee_id=addressee.id,
        status="following" if is_public else "pending",
        message=message if not is_public else None,
    )
    db.add(friendship)
    db.commit()
    db.refresh(friendship)
    return friendship


def respond_to_request(
    db: Session, addressee_id: str, friendship_id: int, accept: bool
):
    """
    Accept or decline an incoming friend request.
    """
    friendship = (
        db.query(Friendship)
        .filter(
            Friendship.id == friendship_id,
            Friendship.addressee_id == addressee_id,
            Friendship.status == "pending",
        )
        .first()
    )
    if not friendship:
        raise HTTPException(status_code=404, detail="Friend request not found.")

    friendship.status = "accepted" if accept else "declined"
    friendship.updated_at = _utcnow()
    if accept:
        # Acted-on: clear the unread inbox row but keep the row as history.
        # (Decline path doesn't need this — the friendship row is left in
        # "declined" state; CASCADE only fires on actual deletes. If we want
        # decline to also drop the notification we'd delete the friendship row.)
        db.execute(
            update(Notification)
            .where(
                Notification.friendship_id == friendship.id,
                Notification.read_at.is_(None),
            )
            .values(read_at=_utcnow())
        )
    db.commit()
    db.refresh(friendship)
    return friendship


def remove_friend(db: Session, user_id: str, friend_id: str):
    """
    Remove an accepted friendship.
    """
    friendship = _get_friendship(db, user_id, friend_id)
    if not friendship or friendship.status != "accepted":
        raise HTTPException(status_code=404, detail="Friendship not found.")

    db.delete(friendship)
    db.commit()


def get_friends(db: Session, user_id: str) -> list[dict]:
    """
    Return all accepted friends with their user info.
    """
    requester_side = (
        db.query(Friendship.id.label("friendship_id"), User.id.label("friend_id"), User.username.label("friend_username"), User.display_name.label("friend_display_name"))
        .join(User, User.id == Friendship.addressee_id)
        .filter(Friendship.requester_id == user_id, Friendship.status == "accepted")
    )
    addressee_side = (
        db.query(Friendship.id.label("friendship_id"), User.id.label("friend_id"), User.username.label("friend_username"), User.display_name.label("friend_display_name"))
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "accepted")
    )
    rows = requester_side.order_by(None).union_all(addressee_side.order_by(None)).all()
    return [
        {"friendship_id": r.friendship_id, "friend": {"id": r.friend_id, "username": r.friend_username, "display_name": r.friend_display_name}}
        for r in rows
    ]


def get_social_preview(db: Session, user_id: str) -> dict:
    """Fetch incoming requests, outgoing requests, and followers in a single UNION query."""
    incoming_q = (
        db.query(
            literal("incoming").label("kind"),
            Friendship.id.label("friendship_id"),
            Friendship.created_at,
            Friendship.message,
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "pending")
    )
    outgoing_q = (
        db.query(
            literal("outgoing").label("kind"),
            Friendship.id.label("friendship_id"),
            Friendship.created_at,
            null().label("message"),
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.addressee_id)
        .filter(Friendship.requester_id == user_id, Friendship.status == "pending")
    )
    followers_q = (
        db.query(
            literal("follower").label("kind"),
            Friendship.id.label("friendship_id"),
            Friendship.created_at,
            null().label("message"),
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "following")
    )

    incoming, outgoing, followers = [], [], []
    rows = sorted(
        incoming_q.order_by(None)
        .union_all(outgoing_q.order_by(None))
        .union_all(followers_q.order_by(None))
        .all(),
        key=lambda r: r.created_at or "",
        reverse=True,
    )
    for r in rows:
        if r.kind == "incoming":
            incoming.append({
                "friendship_id": r.friendship_id,
                "from_user": {"id": r.user_id, "username": r.username, "display_name": r.display_name},
                "created_at": r.created_at,
                "message": r.message,
            })
        elif r.kind == "outgoing":
            outgoing.append({
                "friendship_id": r.friendship_id,
                "to_user": {"id": r.user_id, "username": r.username, "display_name": r.display_name},
                "created_at": r.created_at,
            })
        else:
            followers.append({
                "friendship_id": r.friendship_id,
                "follower": {"id": r.user_id, "username": r.username, "display_name": r.display_name},
            })
    return {"incoming_requests": incoming, "outgoing_requests": outgoing, "followers": followers}


def get_incoming_requests(db: Session, user_id: str) -> list[dict]:
    """
    Return all pending requests addressed to this user.
    """
    rows = (
        db.query(
            Friendship.id,
            Friendship.created_at,
            Friendship.message,
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {
            "friendship_id": r.id,
            "from_user": {"id": r.user_id, "username": r.username, "display_name": r.display_name},
            "created_at": r.created_at,
            "message": r.message,
        }
        for r in rows
    ]


def get_incoming_request_count(db: Session, user_id: str) -> int:
    return (
        db.query(func.count(Friendship.id))
        .filter(Friendship.addressee_id == user_id, Friendship.status == "pending")
        .scalar()
        or 0
    )


def get_outgoing_requests(db: Session, user_id: str) -> list[dict]:
    """
    Return all pending requests sent by this user.
    """
    rows = (
        db.query(
            Friendship.id,
            Friendship.created_at,
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.addressee_id)
        .filter(Friendship.requester_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {
            "friendship_id": r.id,
            "to_user": {"id": r.user_id, "username": r.username, "display_name": r.display_name},
            "created_at": r.created_at,
        }
        for r in rows
    ]


def are_friends(db: Session, user_a: str, user_b: str) -> bool:
    """Return True if the two users have an accepted friendship."""
    friendship = _get_friendship(db, user_a, user_b)
    return friendship is not None and friendship.status == "accepted"


def cancel_friend_request(db: Session, requester_id: str, friendship_id: int):
    """
    Cancel an outgoing pending friend request or unfollow a public user.
    """
    friendship = (
        db.query(Friendship)
        .filter(
            Friendship.id == friendship_id,
            Friendship.requester_id == requester_id,
            Friendship.status.in_(["pending", "following"]),
        )
        .first()
    )
    if not friendship:
        raise HTTPException(status_code=404, detail="Pending request not found.")

    friendship.status = "withdrawn"
    friendship.updated_at = _utcnow()
    db.commit()


# The most-connected users, best first. It's the same for everyone and
# counting it reads the whole friendship table, so it's shared for 10 minutes.
_POPULAR_POOL = 200
_popular_cache: TTLCache = TTLCache(maxsize=1, ttl=600)
_popular_lock = threading.Lock()

_ELIGIBLE = """
    u.username IS NOT NULL
    AND u.profile_visibility != 'private'
    AND u.is_banned = false
"""


def _popular_user_ids(db: Session) -> list[str]:
    with _popular_lock:
        cached = _popular_cache.get("ids")
    if cached is not None:
        return cached
    ids = list(db.execute(text("""
        SELECT uid FROM (
            SELECT requester_id AS uid FROM friendship
            WHERE status IN ('accepted', 'following')
            UNION ALL
            SELECT addressee_id FROM friendship
            WHERE status IN ('accepted', 'following')
        ) connections
        GROUP BY uid
        ORDER BY COUNT(*) DESC, uid
        LIMIT :n
    """), {"n": _POPULAR_POOL}).scalars())
    with _popular_lock:
        _popular_cache["ids"] = ids
    return ids


def _not_suggestable(db: Session, user_id: str) -> set[str]:
    """Me, everyone I'm connected to (incl. pending), and blocks either way."""
    return set(db.execute(text("""
        SELECT addressee_id FROM friendship
        WHERE requester_id = :user_id AND status IN ('accepted', 'following', 'pending')
        UNION
        SELECT requester_id FROM friendship
        WHERE addressee_id = :user_id AND status IN ('accepted', 'following', 'pending')
        UNION
        SELECT blocked_id FROM block WHERE blocker_id = :user_id
        UNION
        SELECT blocker_id FROM block WHERE blocked_id = :user_id
    """), {"user_id": user_id}).scalars()) | {user_id}


def _suggestion(row, mutual_friends: int, reason: str) -> dict:
    return {
        "id": row.id,
        "username": row.username,
        "display_name": row.display_name,
        "profile_visibility": row.profile_visibility or "friends_only",
        "mutual_friends": mutual_friends,
        "reason": reason,
    }


def get_suggested_friends(db: Session, user_id: str, limit: int = 10) -> list[dict]:
    """
    Hybrid suggestion algorithm:
    1. Friends-of-friends ranked by mutual connection count
    2. Popular users (most total connections) as fallback
    Private profiles and blocked/banned users are excluded.
    """
    excluded = _not_suggestable(db, user_id)

    fof_sql = text(f"""
        WITH my_connections AS (
            SELECT addressee_id AS friend_id FROM friendship
            WHERE requester_id = :user_id AND status IN ('accepted', 'following', 'pending')
            UNION
            SELECT requester_id FROM friendship
            WHERE addressee_id = :user_id AND status IN ('accepted', 'following', 'pending')
        ),
        fof AS (
            SELECT candidate, COUNT(*) AS mutual_count
            FROM (
                SELECT f.addressee_id AS candidate
                FROM friendship f JOIN my_connections mc ON f.requester_id = mc.friend_id
                WHERE f.status IN ('accepted', 'following')
                UNION ALL
                SELECT f.requester_id
                FROM friendship f JOIN my_connections mc ON f.addressee_id = mc.friend_id
                WHERE f.status IN ('accepted', 'following')
            ) sub
            GROUP BY candidate
        )
        SELECT u.id, u.username, u.display_name, u.profile_visibility, fof.mutual_count
        FROM fof JOIN "user" u ON u.id = fof.candidate
        WHERE u.id NOT IN :excluded AND {_ELIGIBLE}
        ORDER BY fof.mutual_count DESC, u.id
        LIMIT :limit
    """).bindparams(bindparam("excluded", expanding=True))
    suggestions = [
        _suggestion(row, row.mutual_count, "mutual_friends")
        for row in db.execute(
            fof_sql, {"user_id": user_id, "excluded": list(excluded), "limit": limit}
        )
    ]

    if len(suggestions) < limit:
        taken = excluded | {s["id"] for s in suggestions}
        candidates = [uid for uid in _popular_user_ids(db) if uid not in taken]
        if candidates:
            rows = db.execute(
                text(f"""
                    SELECT u.id, u.username, u.display_name, u.profile_visibility
                    FROM "user" u
                    WHERE u.id IN :ids AND {_ELIGIBLE}
                """).bindparams(bindparam("ids", expanding=True)),
                {"ids": candidates},
            )
            by_id = {row.id: row for row in rows}
            for uid in candidates:
                if len(suggestions) >= limit:
                    break
                if uid in by_id:
                    suggestions.append(_suggestion(by_id[uid], 0, "popular"))

    return suggestions


def get_followers(db: Session, user_id: str) -> list[dict]:
    """
    Return users who are following this user (one-way, not yet mutual friends).
    """
    rows = (
        db.query(
            Friendship.id,
            User.id.label("user_id"),
            User.username,
            User.display_name,
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "following")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {"friendship_id": r.id, "follower": {"id": r.user_id, "username": r.username, "display_name": r.display_name}}
        for r in rows
    ]


def get_friends_content_activity(
    db: Session, user_id: str, content_type: str, content_id: int
) -> list[dict]:
    """Return accepted friends' watch statuses and ratings for a specific content item."""
    # Get accepted friend IDs
    req_side = (
        db.query(Friendship.addressee_id.label("friend_id"))
        .filter(Friendship.requester_id == user_id, Friendship.status == "accepted")
    )
    addr_side = (
        db.query(Friendship.requester_id.label("friend_id"))
        .filter(Friendship.addressee_id == user_id, Friendship.status == "accepted")
    )
    friend_id_rows = req_side.union_all(addr_side).all()
    friend_ids = [r.friend_id for r in friend_id_rows]
    if not friend_ids:
        return []

    watched_q = (
        db.query(
            Watched.user_id,
            literal("Watched").label("status"),
            Watched.rating.label("rating"),
            literal(1).label("prio"),
        )
        .filter(
            Watched.user_id.in_(friend_ids),
            Watched.content_type == content_type,
            Watched.content_id == content_id,
        )
    )
    cw_q = (
        db.query(
            CurrentlyWatching.user_id,
            literal("Currently Watching").label("status"),
            null().label("rating"),
            literal(2).label("prio"),
        )
        .filter(
            CurrentlyWatching.user_id.in_(friend_ids),
            CurrentlyWatching.content_type == content_type,
            CurrentlyWatching.content_id == content_id,
        )
    )
    wl_q = (
        db.query(
            Watchlist.user_id,
            literal("Want To Watch").label("status"),
            null().label("rating"),
            literal(3).label("prio"),
        )
        .filter(
            Watchlist.user_id.in_(friend_ids),
            Watchlist.content_type == content_type,
            Watchlist.content_id == content_id,
        )
    )

    combined = union_all(
        watched_q.statement, cw_q.statement, wl_q.statement
    ).subquery()

    rows = (
        db.query(
            User.username,
            combined.c.status,
            combined.c.rating,
        )
        .join(combined, User.id == combined.c.user_id)
        .filter(User.profile_visibility != "private")
        .distinct(User.username)
        .order_by(User.username, combined.c.prio)
        .all()
    )

    return [{"username": username, "status": status, "rating": rating} for username, status, rating in rows]
