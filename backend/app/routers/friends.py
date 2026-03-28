# app/routers/friends.py
from fastapi import APIRouter, Depends, Body, Query
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import friends_service
from app.services.user_service import search_users_by_username
from app.services.activity_service import get_friends_activity, get_activity_feed
from app.core.event_bus import publish
from app.models.user import User

router = APIRouter()


@router.get("/search")
def search_users(
    q: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Search users by partial username to find someone to add."""
    users = search_users_by_username(db, q, current_user_id=uid)
    return [{"id": u.id, "username": u.username} for u in users]


@router.post("/request")
def send_request(
    addressee_username: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Send a friend request to a user by their username."""
    result = friends_service.send_friend_request(db, uid, addressee_username)
    addressee = db.query(User).filter(User.username == addressee_username).first()
    if addressee:
        publish(addressee.id, "friend_request")
    return result


@router.patch("/respond")
def respond_to_request(
    friendship_id: int = Body(...),
    accept: bool = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Accept or decline an incoming friend request."""
    return friends_service.respond_to_request(db, uid, friendship_id, accept)


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


@router.get("/")
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
