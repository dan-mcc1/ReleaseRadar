# app/routers/user.py
import re
from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.user_service import (
    create_user,
    get_user,
    update_user_email,
    update_username,
    is_username_available,
)
from app.services.friends_service import are_friends
from app.services.user_service import get_profile_watchlist, get_profile_watched
from app.services.stats_service import get_user_stats
from app.dependencies.auth import get_current_user
from app.models.user import User  # needed for the profile lookup by username

router = APIRouter()

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,30}$")


def _validate_username(username: str):
    if not USERNAME_RE.match(username):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3–30 characters and contain only letters, numbers, or underscores.",
        )


@router.post("/create")
def create_user_route(
    db: Session = Depends(get_db),
    uid: str = Body(...),
    email: str | None = Body(None),
    username: str | None = Body(None),
):
    if username is not None:
        _validate_username(username)
        if not is_username_available(db, username):
            raise HTTPException(status_code=409, detail="Username already taken.")
    return create_user(db, uid, email, username)


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
    new_email: str, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
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


@router.get("/check-username")
def check_username_route(
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
        raise HTTPException(status_code=400, detail="Use /user/me for your own profile.")

    is_friend = are_friends(db, uid, target.id)

    profile = {"id": target.id, "username": target.username, "is_friend": is_friend}

    if is_friend:
        profile["watchlist"] = get_profile_watchlist(db, target.id)
        profile["watched"] = get_profile_watched(db, target.id)

    return profile
