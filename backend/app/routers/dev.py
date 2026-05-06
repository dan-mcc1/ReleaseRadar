# app/routers/dev.py
"""
Developer testing endpoints — NOT for production use.
These exist to manually trigger background jobs for local QA.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.show import Show
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.user import User

router = APIRouter()


@router.post("/test-new-season")
def test_new_season(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Simulate a new season being added for a show you have in Watched.

    Steps:
      1. Confirms the show is in your Watched list.
      2. Inserts a temporary fake episode (Season 99, Episode 1) so the
         episode count exceeds your watched-episode count.
      3. Runs check_and_reactivate_watched_shows (affects all users with
         this show in Watched — acceptable for dev environments).
      4. Deletes the fake episode.
      5. Returns whether the show was reactivated and whether an email was sent.

    To receive the email you must have email_notifications enabled in your
    account settings and a valid email address on file.
    """
    from app.services.episode_service import check_and_reactivate_watched_shows

    # 1. Confirm the show is in the user's Watched list
    if not db.query(Watched).filter_by(
        user_id=uid, content_type="tv", content_id=show_id
    ).first():
        raise HTTPException(
            status_code=400,
            detail="Show is not in your Watched list. Mark it as Watched first.",
        )

    show = db.query(Show).filter_by(id=show_id).first()
    user = db.query(User).filter_by(id=uid).first()

    # Snapshot pre-run state
    pre_watched = db.query(Watched).filter_by(
        user_id=uid, content_type="tv", content_id=show_id
    ).first() is not None
    pre_watchlist = db.query(Watchlist).filter_by(
        user_id=uid, content_type="tv", content_id=show_id
    ).first() is not None

    # 2. Insert a clearly fake episode that this user hasn't watched
    FAKE_EP_ID = 999_000_000 + show_id  # unlikely to clash with real TMDB IDs
    if db.query(Episode).filter_by(id=FAKE_EP_ID).first():
        raise HTTPException(
            status_code=409,
            detail=(
                f"Fake episode id={FAKE_EP_ID} already exists — "
                "a previous test may not have cleaned up. "
                "Delete it manually or restart the server."
            ),
        )

    db.add(
        Episode(
            id=FAKE_EP_ID,
            show_id=show_id,
            season_number=99,
            episode_number=1,
            name="[TEST] New Season Episode",
        )
    )
    db.commit()

    # 3. Run the reactivation check
    check_and_reactivate_watched_shows(db)

    # 4. Clean up the fake episode
    fake_ep = db.query(Episode).filter_by(id=FAKE_EP_ID).first()
    if fake_ep:
        db.delete(fake_ep)
    # Also clean up any episode_watched entry that might have been created
    fake_ew = db.query(EpisodeWatched).filter_by(
        show_id=show_id, season_number=99, episode_number=1
    ).first()
    if fake_ew:
        db.delete(fake_ew)
    db.commit()

    # 5. Report results
    post_watchlist = db.query(Watchlist).filter_by(
        user_id=uid, content_type="tv", content_id=show_id
    ).first() is not None
    post_watched = db.query(Watched).filter_by(
        user_id=uid, content_type="tv", content_id=show_id
    ).first() is not None

    reactivated = post_watchlist and not post_watched
    email_attempted = (
        reactivated
        and user is not None
        and bool(user.email_notifications)
        and bool(user.email)
    )

    return {
        "show_id": show_id,
        "show_name": show.name if show else None,
        "reactivated": reactivated,
        "now_on_watchlist": post_watchlist,
        "still_in_watched": post_watched,
        "email_attempted": email_attempted,
        "email_address": user.email if email_attempted else None,
        "tip": (
            None
            if email_attempted
            else "Enable email notifications in settings and ensure your account has an email to receive the alert."
        ),
    }


@router.post("/trigger-episode-refresh")
def trigger_episode_refresh(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Manually run the nightly episode refresh + reactivation check right now.
    Useful for testing against real TMDB data without waiting for 3am.
    """
    from app.services.episode_service import (
        refresh_episodes_for_active_shows,
        check_and_reactivate_watched_shows,
    )

    refresh_episodes_for_active_shows(db)
    check_and_reactivate_watched_shows(db)
    return {"message": "Episode refresh and reactivation check complete."}
