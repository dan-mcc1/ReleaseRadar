# app/routers/user.py
import re
import random
from fastapi import APIRouter, Depends, HTTPException, Body, Query, Request
from app.core.limiter import limiter
from pydantic import EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app.db.session import get_db
from app.services.user_service import (
    create_user,
    get_user,
    update_user_email,
    update_username,
    update_avatar_key,
    is_username_available,
    get_profile_watchlist_preview,
    get_profile_watched_preview,
)
from app.services.friends_service import get_friends, get_incoming_requests, get_outgoing_requests, get_followers
from app.models.friendship import Friendship
from app.services.user_service import get_profile_watchlist, get_profile_watched
from app.services.favorite_service import get_favorites
from app.services.stats_service import get_user_stats
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.episode_watched import EpisodeWatched
from app.models.currently_watching import CurrentlyWatching
from app.models.activity import Activity
from app.models.favorite import Favorite
from app.models.recommendation import Recommendation
from app.models.show import Show
from app.models.movie import Movie
from app.models.episode import Episode

router = APIRouter()

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,30}$")


def _validate_username(username: str):
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3–30 characters and contain only letters, numbers, or underscores.",
        )


@router.post("/create")
@limiter.limit("10/minute")
def create_user_route(
    request: Request,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
    email: str | None = Body(None),
    username: str | None = Body(None),
):
    if username is not None:
        _validate_username(username)
        if not is_username_available(db, username):
            raise HTTPException(status_code=409, detail="Username already taken.")
    avatar = random.choice(VALID_AVATAR_KEYS) if username is not None else None
    return create_user(db, uid, email, username, avatar)


@router.get("/me")
def get_current_user_route(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    user = get_user(db, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/update-email")
def update_email_route(
    new_email: EmailStr = Query(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = update_user_email(db, uid, new_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/update-username")
def update_username_route(
    new_username: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    _validate_username(new_username)
    user = update_username(db, uid, new_username)
    if user is None:
        raise HTTPException(status_code=409, detail="Username already taken.")
    return user


VALID_AVATAR_KEYS = [
    "blue",
    "purple",
    "green",
    "red",
    "orange",
    "teal",
    "pink",
    "yellow",
]


@router.put("/update-avatar")
def update_avatar_route(
    avatar_key: str | None = Body(None, embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if avatar_key is not None and avatar_key not in VALID_AVATAR_KEYS:
        raise HTTPException(status_code=422, detail="Invalid avatar key.")
    user = update_avatar_key(db, uid, avatar_key)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.put("/update-bio")
def update_bio_route(
    bio: str | None = Body(None, embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if bio is not None and len(bio) > 300:
        raise HTTPException(
            status_code=422, detail="Bio must be 300 characters or fewer."
        )
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.bio = bio.strip() if bio else None
    db.commit()
    db.refresh(user)
    return user


@router.get("/check-username")
@limiter.limit("30/minute")
def check_username_route(
    request: Request,
    username: str = Query(...),
    db: Session = Depends(get_db),
):
    """Public endpoint — returns whether a username is available."""
    _validate_username(username)
    return {"available": is_username_available(db, username)}


@router.get("/stats")
def get_stats_route(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return aggregated stats for the current user."""
    return get_user_stats(db, uid)


@router.get("/profile-summary")
def get_profile_summary(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return all data needed for the own-profile page in a single request."""
    user = get_user(db, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "username": user.username,
            "avatar_key": user.avatar_key,
            "bio": user.bio,
            "profile_visibility": user.profile_visibility,
            "created_at": user.created_at,
        },
        "favorites": get_favorites(db, uid),
        "watchlist": get_profile_watchlist_preview(db, uid),
        "watched": get_profile_watched_preview(db, uid),
        "friends": get_friends(db, uid),
        "incoming_requests": get_incoming_requests(db, uid),
        "outgoing_requests": get_outgoing_requests(db, uid),
        "followers": get_followers(db, uid),
    }


@router.get("/profile/{username}")
def get_public_profile(
    username: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Return a user's public profile. Watchlist and watched lists are only
    included when the requesting user is an accepted friend.
    """
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    if target.id == uid:
        raise HTTPException(
            status_code=400, detail="Use /user/me for your own profile."
        )

    visibility = target.profile_visibility or "friends_only"

    # Single query for all relationship rows between viewer and target
    friendship_rows = (
        db.query(Friendship)
        .filter(
            or_(
                and_(Friendship.requester_id == uid, Friendship.addressee_id == target.id),
                and_(Friendship.requester_id == target.id, Friendship.addressee_id == uid),
            )
        )
        .all()
    )

    is_friend = any(r.status == "accepted" for r in friendship_rows)
    pending = next(
        (r for r in friendship_rows
         if r.requester_id == uid and r.addressee_id == target.id and r.status == "pending"),
        None,
    )
    following_row = next(
        (r for r in friendship_rows
         if r.requester_id == uid and r.addressee_id == target.id and r.status == "following"),
        None,
    )
    followed_by_target = next(
        (r for r in friendship_rows
         if r.requester_id == target.id and r.addressee_id == uid and r.status == "following"),
        None,
    )
    incoming_request = next(
        (r for r in friendship_rows
         if r.requester_id == target.id and r.addressee_id == uid and r.status == "pending"),
        None,
    )

    profile = {
        "id": target.id,
        "username": target.username,
        "bio": target.bio,
        "is_friend": is_friend,
        "profile_visibility": visibility,
        "pending_request_id": pending.id if pending else None,
        "incoming_request_id": incoming_request.id if incoming_request else None,
        "is_following": following_row is not None,
        "following_id": following_row.id if following_row else None,
        "is_followed_by_them": followed_by_target is not None,
    }

    # All profile content respects visibility setting
    can_see_details = visibility == "public" or (
        visibility == "friends_only" and is_friend
    )
    if can_see_details:
        profile["favorites"] = get_favorites(db, target.id)

        profile["watchlist"] = get_profile_watchlist(db, target.id)
        profile["watched"] = get_profile_watched(db, target.id)
        profile["friends"] = get_friends(db, target.id)

    return profile


@router.delete("/account")
def delete_account(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Delete the current user's account and all associated data.
    Call this before deleting the Firebase auth account on the client.
    """
    # Collect all content being tracked so we can decrement tracking_count.
    # Watchlist and Watched are mutually exclusive per item, so we can union them.
    tracked: set[tuple[str, int]] = set()

    for row in (
        db.query(Watchlist.content_type, Watchlist.content_id)
        .filter_by(user_id=uid)
        .all()
    ):
        tracked.add((row.content_type, row.content_id))
    for row in (
        db.query(Watched.content_type, Watched.content_id).filter_by(user_id=uid).all()
    ):
        tracked.add((row.content_type, row.content_id))

    # Decrement tracking counts
    for content_type, content_id in tracked:
        if content_type == "movie":
            movie = db.query(Movie).filter_by(id=content_id).first()
            if movie:
                movie.tracking_count = max(0, (movie.tracking_count or 1) - 1)
        elif content_type == "tv":
            show = db.query(Show).filter_by(id=content_id).first()
            if show:
                show.tracking_count = max(0, (show.tracking_count or 1) - 1)

    db.flush()

    # Delete all user data
    db.query(Activity).filter_by(user_id=uid).delete()
    db.query(EpisodeWatched).filter_by(user_id=uid).delete()
    db.query(CurrentlyWatching).filter_by(user_id=uid).delete()
    db.query(Watchlist).filter_by(user_id=uid).delete()
    db.query(Watched).filter_by(user_id=uid).delete()
    db.query(Favorite).filter_by(user_id=uid).delete()
    db.query(Recommendation).filter(
        (Recommendation.sender_id == uid) | (Recommendation.recipient_id == uid)
    ).delete()
    db.query(Friendship).filter(
        (Friendship.requester_id == uid) | (Friendship.addressee_id == uid)
    ).delete()

    # Remove shows/movies no longer tracked by anyone
    for content_type, content_id in tracked:
        if content_type == "movie":
            movie = db.query(Movie).filter_by(id=content_id).first()
            if movie and movie.tracking_count <= 0:
                db.delete(movie)
        elif content_type == "tv":
            show = db.query(Show).filter_by(id=content_id).first()
            if show and show.tracking_count <= 0:
                db.query(EpisodeWatched).filter_by(show_id=content_id).delete()
                db.query(Episode).filter_by(show_id=content_id).delete()
                db.delete(show)

    user = db.query(User).filter_by(id=uid).first()
    if user:
        db.delete(user)

    db.commit()
    return {"message": "Account deleted"}
