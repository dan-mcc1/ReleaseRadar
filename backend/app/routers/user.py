# app/routers/user.py
import random
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.core.limiter import limiter
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app.db.session import get_db
from app.schemas.common import (
    APPEAL_MAX_LEN,
    AvatarKey,
    BIO_MAX_LEN,
    DISPLAY_NAME_MAX_LEN,
    USERNAME_MAX_LEN,
    USERNAME_MIN_LEN,
    USERNAME_PATTERN,
)
from app.services.user_service import (
    create_user,
    get_user,
    update_user_email,
    update_username,
    update_display_name,
    update_avatar_key,
    is_username_available,
    get_profile_watchlist,
    get_profile_watched,
    get_profile_preview_data,
)
from app.services.friends_service import get_friends, get_social_preview
from app.models.friendship import Friendship
from app.services.favorite_service import get_favorites
from app.services.stats_service import get_user_stats
from app.services.watch_time_service import get_watch_time_stats
from datetime import datetime, timezone
from app.dependencies.auth import get_current_user, get_current_user_strict, get_token_claims, get_token_claims_strict, get_uid_only
from app.models.appeal import Appeal
from app.models.shelf_item import ShelfItem
from app.models.shelf import Shelf
from app.models.review import Review
from app.models.report import Report
from app.dependencies.subscription import feature_gate
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
from app.models.block import Block
from firebase_admin import auth as firebase_auth

router = APIRouter()


_USERNAME_FIELD = Field(
    ..., min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
)


class UpdateEmailBody(BaseModel):
    new_email: EmailStr


class CreateUserBody(BaseModel):
    username: str | None = Field(
        None, min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
    )


class UpdateUsernameBody(BaseModel):
    new_username: str = _USERNAME_FIELD


class UpdateAvatarBody(BaseModel):
    avatar_key: AvatarKey | None = None


class UpdateDisplayNameBody(BaseModel):
    display_name: str | None = Field(None, max_length=DISPLAY_NAME_MAX_LEN)


class UpdateBioBody(BaseModel):
    bio: str | None = Field(None, max_length=BIO_MAX_LEN)


class AppealBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=APPEAL_MAX_LEN)
    request_unsilence: bool = False


@router.post("/create")
@limiter.limit("60/minute")
def create_user_route(
    request: Request,
    body: CreateUserBody,
    db: Session = Depends(get_db),
    claims: dict = Depends(get_token_claims),
):
    uid = claims["uid"]
    email = claims.get("email")  # always use the Firebase-verified email
    username = body.username
    if username is not None:
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


@router.post("/acknowledge-warning")
def acknowledge_warning(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == uid).first()
    if user:
        user.has_unread_warning = False
        db.commit()
    return {"detail": "Warning acknowledged."}


@router.get("/account-status")
def get_account_status(
    uid: str = Depends(get_uid_only),
    db: Session = Depends(get_db),
):
    """Returns suspension/ban state. Uses token-only auth so suspended/banned users can reach it."""
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        return {"is_banned": False, "is_suspended": False, "has_pending_appeal": False}

    now = datetime.now(timezone.utc)
    active_suspension = user.is_suspended and (
        user.suspended_until is None or now < user.suspended_until
    )
    pending_appeal = db.query(Appeal).filter_by(user_id=uid, status="pending").first()
    return {
        "is_banned": user.is_banned,
        "ban_reason": user.ban_reason,
        "is_suspended": active_suspension,
        "suspended_until": user.suspended_until,
        "suspension_reason": user.suspension_reason,
        "is_silenced": user.is_silenced,
        "silenced_until": user.silenced_until,
        "has_pending_appeal": pending_appeal is not None,
        "pending_appeal_requests_unsilence": (
            pending_appeal.request_unsilence if pending_appeal else False
        ),
    }


@router.post("/appeal")
def submit_appeal(
    body: AppealBody,
    uid: str = Depends(get_uid_only),
    db: Session = Depends(get_db),
):
    """Submit an appeal for a suspension or ban. Accessible without suspension/ban checks."""
    message = body.message.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Appeal message cannot be empty.")

    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    now = datetime.now(timezone.utc)
    active_suspension = user.is_suspended and (
        user.suspended_until is None or now < user.suspended_until
    )
    if not user.is_banned and not active_suspension:
        raise HTTPException(
            status_code=400, detail="No active suspension or ban to appeal."
        )

    existing = db.query(Appeal).filter_by(user_id=uid, status="pending").first()
    if existing:
        raise HTTPException(
            status_code=409, detail="You already have a pending appeal."
        )

    is_silenced = user.is_silenced or (
        user.silenced_until is not None
        and datetime.now(timezone.utc) < user.silenced_until
    )
    appeal_type = "ban" if user.is_banned else "suspension"
    appeal = Appeal(
        user_id=uid,
        appeal_type=appeal_type,
        message=message,
        request_unsilence=body.request_unsilence and is_silenced,
    )
    db.add(appeal)
    db.commit()
    return {"detail": "Appeal submitted."}


@router.put("/update-email")
def update_email_route(
    body: UpdateEmailBody,
    db: Session = Depends(get_db),
    claims: dict = Depends(get_token_claims_strict),
):
    uid = claims["uid"]
    new_email = body.new_email
    token_email = claims.get("email", "")
    if not claims.get("email_verified"):
        raise HTTPException(
            status_code=403, detail="Email address is not verified in Firebase."
        )
    if token_email.lower() != str(new_email).lower():
        raise HTTPException(
            status_code=403, detail="Email does not match the verified Firebase email."
        )
    user = update_user_email(db, uid, new_email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/update-username")
def update_username_route(
    body: UpdateUsernameBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = update_username(db, uid, body.new_username)
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
    body: UpdateAvatarBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = update_avatar_key(db, uid, body.avatar_key)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.put("/update-display-name")
def update_display_name_route(
    body: UpdateDisplayNameBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = update_display_name(db, uid, body.display_name)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@router.put("/update-bio")
def update_bio_route(
    body: UpdateBioBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    user.bio = body.bio.strip() if body.bio else None
    db.commit()
    db.refresh(user)
    return user


@router.get("/check-username")
@limiter.limit("30/minute")
def check_username_route(
    request: Request,
    username: str = Query(
        ..., min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
    ),
    db: Session = Depends(get_db),
):
    """Public endpoint — returns whether a username is available."""
    return {"available": is_username_available(db, username)}


@router.get("/check-email-banned")
@limiter.limit("10/minute")
def check_email_banned(
    request: Request,
    email: str = Query(...),
    db: Session = Depends(get_db),
):
    """Public endpoint — returns whether an email is on the ban list."""
    from app.models.banned_email import BannedEmail

    banned = (
        db.query(BannedEmail).filter(BannedEmail.email == email.lower().strip()).first()
        is not None
    )
    return {"banned": banned}


@router.get("/stats")
def get_stats_route(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return aggregated stats for the current user."""
    return get_user_stats(db, uid)


@router.get("/watch-time-stats")
def get_watch_time_stats_route(
    year: int | None = Query(None),
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("watch_time_stats")),
):
    """Return watch-time breakdown for Annual Wrapped / stats page."""
    return get_watch_time_stats(db, uid, year=year)


@router.get("/profile-summary")
def get_profile_summary(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return all data needed for the own-profile page in a single request."""
    user = get_user(db, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_data = {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_key": user.avatar_key,
        "bio": user.bio,
        "profile_visibility": user.profile_visibility,
        "created_at": user.created_at,
        "subscription_tier": user.subscription_tier,
    }

    preview = get_profile_preview_data(db, uid)
    social = get_social_preview(db, uid)

    return {
        "user": user_data,
        "favorites": preview["favorites"],
        "watchlist": preview["watchlist"],
        "watched": preview["watched"],
        "friends": preview["friends"],
        "incoming_requests": social["incoming_requests"],
        "outgoing_requests": social["outgoing_requests"],
        "followers": social["followers"],
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

    i_blocked = (
        db.query(Block)
        .filter(Block.blocker_id == uid, Block.blocked_id == target.id)
        .first()
    )
    they_blocked = (
        db.query(Block)
        .filter(Block.blocker_id == target.id, Block.blocked_id == uid)
        .first()
    )

    if they_blocked:
        raise HTTPException(status_code=404, detail="User not found.")
    if i_blocked:
        return {
            "id": target.id,
            "username": target.username,
            "display_name": target.display_name,
            "blocked_by_viewer": True,
        }

    visibility = target.profile_visibility or "friends_only"

    # Single query for all relationship rows between viewer and target
    friendship_rows = (
        db.query(Friendship)
        .filter(
            or_(
                and_(
                    Friendship.requester_id == uid, Friendship.addressee_id == target.id
                ),
                and_(
                    Friendship.requester_id == target.id, Friendship.addressee_id == uid
                ),
            )
        )
        .all()
    )

    is_friend = any(r.status == "accepted" for r in friendship_rows)
    pending = next(
        (
            r
            for r in friendship_rows
            if r.requester_id == uid
            and r.addressee_id == target.id
            and r.status == "pending"
        ),
        None,
    )
    following_row = next(
        (
            r
            for r in friendship_rows
            if r.requester_id == uid
            and r.addressee_id == target.id
            and r.status == "following"
        ),
        None,
    )
    followed_by_target = next(
        (
            r
            for r in friendship_rows
            if r.requester_id == target.id
            and r.addressee_id == uid
            and r.status == "following"
        ),
        None,
    )
    incoming_request = next(
        (
            r
            for r in friendship_rows
            if r.requester_id == target.id
            and r.addressee_id == uid
            and r.status == "pending"
        ),
        None,
    )

    profile = {
        "id": target.id,
        "username": target.username,
        "display_name": target.display_name,
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


@router.post("/complete-onboarding")
def complete_onboarding_route(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.onboarding_completed = True
    db.commit()
    return {"onboarding_completed": True}


@router.post("/dismiss-letterboxd-prompt")
def dismiss_letterboxd_prompt(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.letterboxd_prompted = True
    db.commit()
    return {"letterboxd_prompted": True}


@router.post("/subscription/cancel")
def cancel_subscription(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.subscription_tier == "admin":
        raise HTTPException(
            status_code=403, detail="Admin accounts cannot be modified this way"
        )
    user.subscription_tier = "free"
    db.commit()
    return {"subscription_tier": "free"}


@router.delete("/account")
def delete_account(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user_strict),
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
    db.query(ShelfItem).filter(ShelfItem.user_id == uid).delete()
    db.query(Shelf).filter(Shelf.user_id == uid).delete()
    db.query(Review).filter(Review.user_id == uid).delete()
    db.query(Favorite).filter(Favorite.user_id == uid).delete()
    db.query(Activity).filter(Activity.user_id == uid).delete()
    db.query(EpisodeWatched).filter(EpisodeWatched.user_id == uid).delete()
    db.query(CurrentlyWatching).filter(CurrentlyWatching.user_id == uid).delete()
    db.query(Watched).filter(Watched.user_id == uid).delete()
    db.query(Watchlist).filter(Watchlist.user_id == uid).delete()
    db.query(Block).filter(
        (Block.blocker_id == uid) | (Block.blocked_id == uid)
    ).delete(synchronize_session=False)
    db.query(Report).filter(Report.reporter_id == uid).update(
        {Report.reporter_id: None}, synchronize_session=False
    )

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

    try:
        firebase_auth.delete_user(uid)
    except firebase_auth.UserNotFoundError:
        pass

    return {"message": "Account deleted"}
