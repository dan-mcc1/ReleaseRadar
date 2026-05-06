# app/routers/friends.py
from fastapi import APIRouter, Depends, Body, Query, Request
from sqlalchemy.orm import Session
from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import friends_service
from app.services.friends_service import get_followers
from app.services.user_service import search_users_by_username
from app.services.activity_service import (
    get_friends_activity,
    get_activity_feed,
    get_my_activity,
)
from app.core.event_bus import publish
from app.models.user import User
from app.models.friendship import Friendship
from app.services.recommendation_service import get_unread_count

router = APIRouter()


@router.get("/search")
@limiter.limit("30/minute")
def search_users(
    request: Request,
    q: str = Query(..., min_length=1, max_length=50),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Search users by partial username to find someone to add."""
    users = search_users_by_username(db, q, current_user_id=uid)
    return [
        {
            "id": u.id,
            "username": u.username,
            "profile_visibility": u.profile_visibility or "friends_only",
        }
        for u in users
    ]


@router.post("/request")
@limiter.limit("20/minute")
def send_request(
    request: Request,
    addressee_username: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Send a friend request to a user by their username."""
    result = friends_service.send_friend_request(db, uid, addressee_username)
    addressee = db.query(User).filter(User.username == addressee_username).first()
    if addressee:
        pending_count = (
            db.query(Friendship)
            .filter(Friendship.addressee_id == addressee.id, Friendship.status == "pending")
            .count()
        )
        unread_count = get_unread_count(db, addressee.id)
        publish(addressee.id, {
            "type": "counts_update",
            "pending_requests": pending_count,
            "unread_recs": unread_count,
        })
    return result


@router.patch("/respond")
def respond_to_request(
    friendship_id: int = Body(...),
    accept: bool = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Accept or decline an incoming friend request."""
    result = friends_service.respond_to_request(db, uid, friendship_id, accept)
    pending_count = (
        db.query(Friendship)
        .filter(Friendship.addressee_id == uid, Friendship.status == "pending")
        .count()
    )
    unread_count = get_unread_count(db, uid)
    publish(uid, {
        "type": "counts_update",
        "pending_requests": pending_count,
        "unread_recs": unread_count,
    })
    return result


@router.delete("/cancel/{friendship_id}")
def cancel_request(
    friendship_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Cancel an outgoing pending friend request."""
    friends_service.cancel_friend_request(db, uid, friendship_id)
    return {"detail": "Request cancelled."}


@router.delete("/remove/{friend_id}")
def remove_friend(
    friend_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Remove an accepted friend."""
    friends_service.remove_friend(db, uid, friend_id)
    return {"detail": "Friend removed."}


@router.get("")
def get_friends(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get all accepted friends."""
    return friends_service.get_friends(db, uid)


@router.get("/requests/incoming")
def get_incoming(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get all pending incoming friend requests."""
    return friends_service.get_incoming_requests(db, uid)


@router.get("/requests/outgoing")
def get_outgoing(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get all pending outgoing friend requests."""
    return friends_service.get_outgoing_requests(db, uid)


@router.get("/followers")
def get_my_followers(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get users who are following the current user (one-way, not yet mutual)."""
    return get_followers(db, uid)


@router.get("/my-activity")
def my_activity(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get the current user's own activity."""
    return get_my_activity(db, uid)


@router.get("/activity")
def friends_activity(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get recent activity from accepted friends."""
    return get_friends_activity(db, uid)


@router.get("/feed")
def activity_feed(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get own activity + friends' activity combined, newest first."""
    return get_activity_feed(db, uid)
