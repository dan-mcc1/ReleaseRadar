# app/services/friends_service.py
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from fastapi import HTTPException

from app.models.friendship import Friendship
from app.models.user import User

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


def send_friend_request(db: Session, requester_id: str, addressee_username: str):
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
    friendships = (
        db.query(Friendship)
        .filter(
            or_(Friendship.requester_id == user_id, Friendship.addressee_id == user_id),
            Friendship.status == "accepted",
        )
        .all()
    )

    friend_ids = [
        f.addressee_id if f.requester_id == user_id else f.requester_id
        for f in friendships
    ]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(friend_ids)).all()}

    return [
        {
            "friendship_id": f.id,
            "friend": _serialize_user(
                users[f.addressee_id if f.requester_id == user_id else f.requester_id]
            ),
        }
        for f in friendships
        if (f.addressee_id if f.requester_id == user_id else f.requester_id) in users
    ]


def get_incoming_requests(db: Session, user_id: str) -> list[dict]:
    """
    Return all pending requests addressed to this user.
    """
    friendships = (
        db.query(Friendship)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )

    requester_ids = [f.requester_id for f in friendships]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(requester_ids)).all()}

    return [
        {
            "friendship_id": f.id,
            "from_user": _serialize_user(users[f.requester_id]),
            "created_at": f.created_at,
        }
        for f in friendships
        if f.requester_id in users
    ]


def get_outgoing_requests(db: Session, user_id: str) -> list[dict]:
    """
    Return all pending requests sent by this user.
    """
    friendships = (
        db.query(Friendship)
        .filter(Friendship.requester_id == user_id, Friendship.status == "pending")
        .order_by(Friendship.created_at.desc())
        .all()
    )

    addressee_ids = [f.addressee_id for f in friendships]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(addressee_ids)).all()}

    return [
        {
            "friendship_id": f.id,
            "to_user": _serialize_user(users[f.addressee_id]),
            "created_at": f.created_at,
        }
        for f in friendships
        if f.addressee_id in users
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


def get_followers(db: Session, user_id: str) -> list[dict]:
    """
    Return users who are following this user (one-way, not yet mutual friends).
    """
    followings = (
        db.query(Friendship)
        .filter(Friendship.addressee_id == user_id, Friendship.status == "following")
        .order_by(Friendship.created_at.desc())
        .all()
    )

    follower_ids = [f.requester_id for f in followings]
    users = {u.id: u for u in db.query(User).filter(User.id.in_(follower_ids)).all()}

    return [
        {"friendship_id": f.id, "follower": _serialize_user(users[f.requester_id])}
        for f in followings
        if f.requester_id in users
    ]
