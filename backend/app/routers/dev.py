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
    if (
        not db.query(Watched)
        .filter_by(user_id=uid, content_type="tv", content_id=show_id)
        .first()
    ):
        raise HTTPException(
            status_code=400,
            detail="Show is not in your Watched list. Mark it as Watched first.",
        )

    show = db.query(Show).filter_by(id=show_id).first()
    user = db.query(User).filter_by(id=uid).first()

    # Snapshot pre-run state
    pre_watched = (
        db.query(Watched)
        .filter_by(user_id=uid, content_type="tv", content_id=show_id)
        .first()
        is not None
    )
    pre_watchlist = (
        db.query(Watchlist)
        .filter_by(user_id=uid, content_type="tv", content_id=show_id)
        .first()
        is not None
    )

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
    fake_ew = (
        db.query(EpisodeWatched)
        .filter_by(show_id=show_id, season_number=99, episode_number=1)
        .first()
    )
    if fake_ew:
        db.delete(fake_ew)
    db.commit()

    # 5. Report results
    post_watchlist = (
        db.query(Watchlist)
        .filter_by(user_id=uid, content_type="tv", content_id=show_id)
        .first()
        is not None
    )
    post_watched = (
        db.query(Watched)
        .filter_by(user_id=uid, content_type="tv", content_id=show_id)
        .first()
        is not None
    )

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


@router.post("/trigger-streaming-refresh")
def trigger_streaming_refresh(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Manually run the streaming provider refresh right now against live TMDb data.

    Fetches fresh watch/providers for every tracked item, diffs against stored
    providers, updates the DB, and sends notification emails to any opted-in
    users whose tracked content changed.

    Returns a summary of what changed and whether emails were attempted.
    Note: affects all users who track changed content — acceptable for dev.
    """
    from collections import defaultdict
    from app.services.streaming_notification_service import (
        _fetch_fresh_us_providers,
        _diff_and_update_providers,
    )
    from app.models.currently_watching import CurrentlyWatching
    from app.models.movie import Movie
    from app.models.show import Show
    from app.models.user import User
    from app.services.email_service import send_streaming_alert_email

    tracked: set[tuple[int, str]] = set()
    for row in db.query(Watchlist.content_id, Watchlist.content_type).distinct():
        tracked.add((row.content_id, row.content_type))
    for row in db.query(CurrentlyWatching.content_id, CurrentlyWatching.content_type).distinct():
        tracked.add((row.content_id, row.content_type))

    changes: dict[tuple[int, str], dict] = {}
    errors: list[str] = []

    for content_id, content_type in tracked:
        try:
            fresh = _fetch_fresh_us_providers(content_id, content_type)
            added, removed = _diff_and_update_providers(db, content_id, content_type, fresh)
            if added or removed:
                changes[(content_id, content_type)] = {"added": added, "removed": removed}
        except Exception as e:
            errors.append(f"{content_type}:{content_id} — {e}")

    db.commit()

    if not changes:
        return {
            "items_checked": len(tracked),
            "changes_detected": 0,
            "emails_attempted": 0,
            "errors": errors,
            "message": "No provider changes detected.",
        }

    movie_ids = [cid for (cid, ct) in changes if ct == "movie"]
    show_ids = [cid for (cid, ct) in changes if ct == "tv"]
    movie_info = {m.id: {"title": m.title, "poster_path": m.poster_path} for m in db.query(Movie).filter(Movie.id.in_(movie_ids))}
    show_info = {s.id: {"title": s.name, "poster_path": s.poster_path} for s in db.query(Show).filter(Show.id.in_(show_ids))}

    user_alerts: dict[str, list] = defaultdict(list)
    change_summary = []

    for (content_id, content_type), change in changes.items():
        info = (movie_info if content_type == "movie" else show_info).get(content_id, {})
        alert = {
            "title": info.get("title", f"{content_type}:{content_id}"),
            "content_type": content_type,
            "content_id": content_id,
            "poster_path": info.get("poster_path"),
            "added": change["added"],
            "removed": change["removed"],
        }
        change_summary.append({"title": alert["title"], "added": change["added"], "removed": change["removed"]})

        watchlist_uids = {r.user_id for r in db.query(Watchlist.user_id).filter(
            Watchlist.content_id == content_id,
            Watchlist.content_type == content_type,
            Watchlist.notify == True,  # noqa: E712
        )}
        cw_uids = {r.user_id for r in db.query(CurrentlyWatching.user_id).filter(
            CurrentlyWatching.content_id == content_id,
            CurrentlyWatching.content_type == content_type,
        )}
        for user_id in watchlist_uids | cw_uids:
            user_alerts[user_id].append(alert)

    users = (
        db.query(User)
        .filter(
            User.id.in_(list(user_alerts.keys())),
            User.email_notifications == True,  # noqa: E712
            User.notify_streaming_changes == True,  # noqa: E712
            User.email != None,  # noqa: E711
        )
        .all()
    )

    emails_attempted = 0
    for user in users:
        try:
            send_streaming_alert_email(user.email, user.username or "", user_alerts[user.id], uid=user.id)
            emails_attempted += 1
        except Exception as e:
            errors.append(f"email:{user.email} — {e}")

    return {
        "items_checked": len(tracked),
        "changes_detected": len(changes),
        "changes": change_summary,
        "emails_attempted": emails_attempted,
        "errors": errors,
    }


@router.post("/test-streaming-email")
def test_streaming_email(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Send a test streaming alert email to the current user with fake data.
    Useful for previewing the email template without waiting for a real change.

    Requires email_notifications to be enabled and an email address on file.
    """
    from app.services.email_service import send_streaming_alert_email

    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email:
        raise HTTPException(status_code=400, detail="No email address on file")
    if not user.email_notifications:
        raise HTTPException(status_code=400, detail="Email notifications are disabled — enable them in Settings first")

    fake_alerts = [
        {
            "title": "The Bear",
            "content_type": "tv",
            "content_id": 136315,
            "poster_path": "/sHFlbKS3WLqMnp9t2ghADIJFnuQ.jpg",
            "added": ["Netflix"],
            "removed": [],
        },
        {
            "title": "Oppenheimer",
            "content_type": "movie",
            "content_id": 872585,
            "poster_path": "/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg",
            "added": [],
            "removed": ["Max"],
        },
    ]

    send_streaming_alert_email(user.email, user.username or "", fake_alerts, uid=uid)

    return {
        "message": f"Test streaming alert sent to {user.email}",
        "fake_alerts": [{"title": a["title"], "added": a["added"], "removed": a["removed"]} for a in fake_alerts],
    }
