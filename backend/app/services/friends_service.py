# app/services/friends_service.py
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func, literal, null
from fastapi import HTTPException

from app.models.friendship import Friendship
from app.models.user import User
from app.models.block import Block
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching

# Configurable limits
MAX_PENDING_OUTGOING = 25
DECLINED_COOLDOWN_DAYS = 30


def _utcnow():
    return datetime.now(timezone.utc)


def _serialize_user(user: User) -> dict:
    return {"id": user.id, "username": user.username}


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
        db.query(Friendship.id.label("friendship_id"), User.id.label("friend_id"), User.username.label("friend_username"))
        .join(User, User.id == Friendship.addressee_id)
        .filter(Friendship.requester_id == user_id, Friendship.status == "accepted")
    )
    addressee_side = (
        db.query(Friendship.id.label("friendship_id"), User.id.label("friend_id"), User.username.label("friend_username"))
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "accepted")
    )
    rows = requester_side.order_by(None).union_all(addressee_side.order_by(None)).all()
    return [
        {"friendship_id": r.friendship_id, "friend": {"id": r.friend_id, "username": r.friend_username}}
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
                "from_user": {"id": r.user_id, "username": r.username},
                "created_at": r.created_at,
                "message": r.message,
            })
        elif r.kind == "outgoing":
            outgoing.append({
                "friendship_id": r.friendship_id,
                "to_user": {"id": r.user_id, "username": r.username},
                "created_at": r.created_at,
            })
        else:
            followers.append({
                "friendship_id": r.friendship_id,
                "follower": {"id": r.user_id, "username": r.username},
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
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {
            "friendship_id": r.id,
            "from_user": {"id": r.user_id, "username": r.username},
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
        )
        .join(User, User.id == Friendship.addressee_id)
        .filter(Friendship.requester_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {
            "friendship_id": r.id,
            "to_user": {"id": r.user_id, "username": r.username},
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

    db.delete(friendship)
    db.commit()


def get_suggested_friends(db: Session, user_id: str, limit: int = 10) -> list[dict]:
    """
    Hybrid suggestion algorithm:
    1. Friends-of-friends ranked by mutual connection count
    2. Popular users (most total connections) as fallback
    Private profiles and blocked/banned users are excluded.
    """
    # Build the set of IDs to exclude from suggestions
    connected_req = db.query(Friendship.addressee_id).filter(
        Friendship.requester_id == user_id,
        Friendship.status.in_(["accepted", "following", "pending"]),
    )
    connected_addr = db.query(Friendship.requester_id).filter(
        Friendship.addressee_id == user_id,
        Friendship.status.in_(["accepted", "following", "pending"]),
    )
    blocked_ids = db.query(Block.blocked_id).filter(Block.blocker_id == user_id)
    blocker_ids = db.query(Block.blocker_id).filter(Block.blocked_id == user_id)

    exclude_ids: set[str] = {user_id}
    for (uid,) in connected_req.all():
        exclude_ids.add(uid)
    for (uid,) in connected_addr.all():
        exclude_ids.add(uid)
    for (uid,) in blocked_ids.all():
        exclude_ids.add(uid)
    for (uid,) in blocker_ids.all():
        exclude_ids.add(uid)

    my_friend_ids = list(exclude_ids - {user_id})

    # --- Step 1: friends-of-friends ---
    fof_counts: dict[str, int] = {}
    if my_friend_ids:
        fof_req = (
            db.query(Friendship.addressee_id)
            .filter(
                Friendship.requester_id.in_(my_friend_ids),
                Friendship.status.in_(["accepted", "following"]),
            )
            .all()
        )
        fof_addr = (
            db.query(Friendship.requester_id)
            .filter(
                Friendship.addressee_id.in_(my_friend_ids),
                Friendship.status.in_(["accepted", "following"]),
            )
            .all()
        )
        for (uid,) in fof_req:
            if uid not in exclude_ids:
                fof_counts[uid] = fof_counts.get(uid, 0) + 1
        for (uid,) in fof_addr:
            if uid not in exclude_ids:
                fof_counts[uid] = fof_counts.get(uid, 0) + 1

    suggestions: list[dict] = []
    if fof_counts:
        sorted_fof = sorted(fof_counts.items(), key=lambda x: x[1], reverse=True)
        fof_ids = [uid for uid, _ in sorted_fof[:limit]]
        fof_users = (
            db.query(User)
            .filter(
                User.id.in_(fof_ids),
                User.username.isnot(None),
                User.profile_visibility != "private",
                User.is_banned == False,
            )
            .all()
        )
        user_map = {u.id: u for u in fof_users}
        for uid, mutual in sorted_fof[:limit]:
            if uid in user_map:
                u = user_map[uid]
                suggestions.append(
                    {
                        "id": u.id,
                        "username": u.username,
                        "profile_visibility": u.profile_visibility or "friends_only",
                        "mutual_friends": mutual,
                        "reason": "mutual_friends",
                    }
                )

    # --- Step 2: popular users fallback ---
    if len(suggestions) < limit:
        needed = limit - len(suggestions)
        already_suggested = exclude_ids | {s["id"] for s in suggestions}

        # Count total connections per user via UNION subquery
        # Union the raw queries before subquery-ing so column labels are preserved
        req_counts_q = (
            db.query(
                Friendship.requester_id.label("uid"),
                func.count().label("cnt"),
            )
            .filter(Friendship.status.in_(["accepted", "following"]))
            .group_by(Friendship.requester_id)
        )
        addr_counts_q = (
            db.query(
                Friendship.addressee_id.label("uid"),
                func.count().label("cnt"),
            )
            .filter(Friendship.status.in_(["accepted", "following"]))
            .group_by(Friendship.addressee_id)
        )
        combined = req_counts_q.union_all(addr_counts_q).subquery()
        total_counts_sub = (
            db.query(
                combined.c.uid,
                func.sum(combined.c.cnt).label("total"),
            )
            .group_by(combined.c.uid)
            .subquery()
        )

        popular_rows = (
            db.query(User, total_counts_sub.c.total)
            .join(total_counts_sub, User.id == total_counts_sub.c.uid)
            .filter(
                User.id.notin_(list(already_suggested)),
                User.username.isnot(None),
                User.profile_visibility != "private",
                User.is_banned == False,
            )
            .order_by(total_counts_sub.c.total.desc())
            .limit(needed)
            .all()
        )

        for u, _ in popular_rows:
            suggestions.append(
                {
                    "id": u.id,
                    "username": u.username,
                    "profile_visibility": u.profile_visibility or "friends_only",
                    "mutual_friends": 0,
                    "reason": "popular",
                }
            )

    return suggestions[:limit]


def get_followers(db: Session, user_id: str) -> list[dict]:
    """
    Return users who are following this user (one-way, not yet mutual friends).
    """
    rows = (
        db.query(
            Friendship.id,
            User.id.label("user_id"),
            User.username,
        )
        .join(User, User.id == Friendship.requester_id)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "following")
        .order_by(Friendship.created_at.desc())
        .all()
    )
    return [
        {"friendship_id": r.id, "follower": {"id": r.user_id, "username": r.username}}
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

    results: list[dict] = []

    # Watched
    watched_rows = (
        db.query(User.username, Watched.rating)
        .join(Watched, User.id == Watched.user_id)
        .filter(
            Watched.user_id.in_(friend_ids),
            Watched.content_type == content_type,
            Watched.content_id == content_id,
        )
        .all()
    )
    for username, rating in watched_rows:
        results.append({"username": username, "status": "Watched", "rating": rating})

    watched_usernames = {r["username"] for r in results}

    # Currently Watching
    cw_rows = (
        db.query(User.username)
        .join(CurrentlyWatching, User.id == CurrentlyWatching.user_id)
        .filter(
            CurrentlyWatching.user_id.in_(friend_ids),
            CurrentlyWatching.content_type == content_type,
            CurrentlyWatching.content_id == content_id,
            User.username.notin_(watched_usernames),
        )
        .all()
    )
    for (username,) in cw_rows:
        results.append({"username": username, "status": "Currently Watching", "rating": None})

    cw_usernames = {r["username"] for r in results if r["status"] == "Currently Watching"}

    # Watchlist
    wl_rows = (
        db.query(User.username)
        .join(Watchlist, User.id == Watchlist.user_id)
        .filter(
            Watchlist.user_id.in_(friend_ids),
            Watchlist.content_type == content_type,
            Watchlist.content_id == content_id,
            User.username.notin_(watched_usernames | cw_usernames),
        )
        .all()
    )
    for (username,) in wl_rows:
        results.append({"username": username, "status": "Want To Watch", "rating": None})

    return results
