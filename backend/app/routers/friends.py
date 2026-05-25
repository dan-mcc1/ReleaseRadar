# app/routers/friends.py
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.schemas.common import (
    FRIEND_REQUEST_MSG_MAX_LEN,
    USERNAME_MAX_LEN,
    USERNAME_MIN_LEN,
    USERNAME_PATTERN,
)
from app.services import friends_service
from app.services.friends_service import get_followers, get_suggested_friends
from app.services.user_service import search_users_by_username
from app.services.activity_service import (
    get_friends_activity,
    get_activity_feed,
    get_my_activity,
)
from app.models.user import User
from app.services.nav_counts import notify_counts_changed
from app.services.push_service import push_notification

router = APIRouter()


class FriendRequestBody(BaseModel):
    addressee_username: str = Field(
        ..., min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
    )
    message: str | None = Field(None, max_length=FRIEND_REQUEST_MSG_MAX_LEN)


class FriendRespondBody(BaseModel):
    friendship_id: int = Field(..., ge=1)
    accept: bool


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
            "display_name": u.display_name,
            "profile_visibility": u.profile_visibility or "friends_only",
        }
        for u in users
    ]


@router.get("/suggestions")
@limiter.limit("20/minute")
def suggest_friends(
    request: Request,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return suggested users to connect with."""
    return get_suggested_friends(db, uid)


@router.post("/request")
@limiter.limit("5/minute")
def send_request(
    request: Request,
    body: FriendRequestBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Send a friend request to a user by their username."""
    addressee_username = body.addressee_username
    result = friends_service.send_friend_request(db, uid, addressee_username, body.message)
    addressee = db.query(User).filter(User.username == addressee_username).first()
    if addressee:
        notify_counts_changed(db, addressee.id)

        # Only push when the result is actually awaiting action ("pending"). Public
        # profiles auto-follow ("following") and the auto-accept path returns
        # "accepted" — neither needs a "you've got a request" banner.
        if result.status == "pending":
            requester = db.query(User).filter_by(id=uid).first()
            requester_name = (requester.username if requester else None) or "Someone"
            push_body = (
                f"{requester_name} wants to be friends"
                + (f": \"{body.message}\"" if body.message else "")
            )
            try:
                push_notification(
                    db,
                    addressee.id,
                    type="friend_request",
                    title="New friend request",
                    body=push_body,
                    friendship_id=result.id,
                )
            except Exception:
                pass
    return result


@router.patch("/respond")
def respond_to_request(
    body: FriendRespondBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Accept or decline an incoming friend request."""
    result = friends_service.respond_to_request(db, uid, body.friendship_id, body.accept)
    notify_counts_changed(db, uid)
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


@router.get("/requests/incoming/count")
def get_incoming_count(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return the count of pending incoming friend requests."""
    return {"count": friends_service.get_incoming_request_count(db, uid)}


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


@router.get("/content/{content_type}/{content_id}")
def friends_content_activity(
    content_type: str,
    content_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return accepted friends' watch statuses and ratings for a specific content item."""
    if content_type not in ("movie", "tv"):
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="content_type must be 'movie' or 'tv'")
    return friends_service.get_friends_content_activity(db, uid, content_type, content_id)


@router.get("/feed")
def activity_feed(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Get own activity + friends' activity combined, newest first."""
    return get_activity_feed(db, uid)
