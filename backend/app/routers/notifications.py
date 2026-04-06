import hmac
import hashlib
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.models.season import Season
from app.models.episode import Episode
from app.services.email_service import (
    send_notification_email,
    send_season_premiere_email,
    format_air_time,
)
from app.config import settings
from datetime import date, timedelta
from collections import defaultdict

router = APIRouter()

VALID_FREQUENCIES = {"daily", "weekly", "monthly"}
VALID_VISIBILITIES = {"public", "friends_only", "private"}


class PreferencesUpdate(BaseModel):
    email_notifications: bool | None = None
    notification_frequency: str | None = None
    profile_visibility: str | None = None


@router.get("/preferences")
def get_notification_preferences(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency or "daily",
        "profile_visibility": user.profile_visibility or "friends_only",
    }


@router.patch("/preferences")
def update_notification_preferences(
    body: PreferencesUpdate,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.email_notifications is not None:
        user.email_notifications = body.email_notifications

    if body.notification_frequency is not None:
        if body.notification_frequency not in VALID_FREQUENCIES:
            raise HTTPException(
                status_code=422, detail="Invalid notification frequency."
            )
        user.notification_frequency = body.notification_frequency

    if body.profile_visibility is not None:
        if body.profile_visibility not in VALID_VISIBILITIES:
            raise HTTPException(status_code=422, detail="Invalid profile visibility.")
        user.profile_visibility = body.profile_visibility

    db.commit()
    return {
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency,
        "profile_visibility": user.profile_visibility,
    }


def _build_items_for_window(db: Session, user_id: str, days: int) -> list:
    """Find watchlisted movies/shows releasing within the next `days` days."""
    today = date.today()
    end = today + timedelta(days=days)
    upcoming = []

    movies = (
        db.query(Movie)
        .join(Watchlist, Watchlist.content_id == Movie.id)
        .filter(
            Watchlist.user_id == user_id,
            Watchlist.content_type == "movie",
            Movie.release_date >= today,
            Movie.release_date < end,
        )
        .all()
    )

    for m in movies:
        upcoming.append(
            {
                "title": m.title,
                "date": str(m.release_date),
                "content_type": "movie",
                "content_id": m.id,
                "poster_path": m.poster_path,
            }
        )

    # 📺 Episodes
    episodes = (
        db.query(Episode, Show)
        .join(Show, Show.id == Episode.show_id)
        .join(Watchlist, Watchlist.content_id == Show.id)
        .filter(
            Watchlist.user_id == user_id,
            Watchlist.content_type == "tv",
            Episode.air_date >= today,
            Episode.air_date < end,
        )
        .all()
    )
    for ep, show in episodes:
        upcoming.append(
            {
                "title": f"{show.name} S{ep.season_number:02d}E{ep.episode_number:02d}"
                + (f" — {ep.name}" if ep.name else ""),
                "date": str(ep.air_date),
                "air_time": format_air_time(show.air_time, show.air_timezone),
                "content_type": "tv",
                "content_id": show.id,
                "poster_path": show.poster_path,
                "episode_type": ep.episode_type,
            }
        )

    watching_episodes = (
        db.query(Episode, Show)
        .join(Show, Show.id == Episode.show_id)
        .join(CurrentlyWatching, CurrentlyWatching.content_id == Show.id)
        .filter(
            CurrentlyWatching.user_id == user_id,
            CurrentlyWatching.content_type == "tv",
            Episode.air_date >= today,
            Episode.air_date < end,
        )
        .all()
    )

    for ep, show in watching_episodes:
        upcoming.append(
            {
                "title": f"{show.name} S{ep.season_number:02d}E{ep.episode_number:02d}"
                + (f" — {ep.name}" if ep.name else ""),
                "date": str(ep.air_date),
                "air_time": format_air_time(show.air_time, show.air_timezone),
                "content_type": "tv",
                "content_id": show.id,
                "poster_path": show.poster_path,
                "episode_type": ep.episode_type,
            }
        )

    return upcoming


def _frequency_window(frequency: str) -> int:
    """Return the number of days to look ahead for a given frequency."""
    return {"daily": 1, "weekly": 7, "monthly": 30}.get(frequency, 1)


def _should_send_today(frequency: str) -> bool:
    """Return True if the digest should be sent today for the given frequency."""
    today = date.today()
    if frequency == "daily":
        return True
    if frequency == "weekly":
        return today.weekday() == 0  # Monday
    if frequency == "monthly":
        return today.day == 1
    return False


def send_season_premiere_alerts_to_all(db: Session):
    """
    Send season-premiere alert emails to opted-in users.
    Fires when a tracked show has a season premiering in exactly 30 or 7 days.
    """
    today = date.today()
    target_dates = {
        30: today + timedelta(days=30),
        7: today + timedelta(days=7),
    }

    # Find all seasons whose air_date matches either target date
    upcoming_seasons = (
        db.query(Season).filter(Season.air_date.in_(target_dates.values())).all()
    )
    if not upcoming_seasons:
        return

    # Map show_id -> list of alert dicts
    show_alerts: dict[int, list] = defaultdict(list)
    for season in upcoming_seasons:
        show = db.query(Show).filter_by(id=season.show_id).first()
        if not show:
            continue
        days_away = next(d for d, dt in target_dates.items() if dt == season.air_date)
        show_alerts[season.show_id].append(
            {
                "show_name": show.name,
                "season_number": season.season_number,
                "season_name": season.name,
                "air_date": str(season.air_date),
                "days_away": days_away,
                "show_id": show.id,
                "poster_path": show.poster_path,
            }
        )

    if not show_alerts:
        return

    # Find all opted-in users who are tracking at least one of those shows
    affected_show_ids = list(show_alerts.keys())
    users = (
        db.query(User)
        .filter(User.email_notifications == True, User.email != None)
        .all()
    )

    for user in users:
        try:
            tracked_show_ids = {
                r.content_id
                for r in db.query(Watchlist.content_id)
                .filter_by(user_id=user.id, content_type="tv")
                .all()
            } | {
                r.content_id
                for r in db.query(Watched.content_id)
                .filter_by(user_id=user.id, content_type="tv")
                .all()
            }

            alerts = [
                alert
                for show_id in affected_show_ids
                if show_id in tracked_show_ids
                for alert in show_alerts[show_id]
            ]
            if alerts:
                send_season_premiere_email(
                    user.email, user.username or "", alerts, uid=user.id
                )
        except Exception as e:
            print(f"[season alert] Failed for {user.email}: {e}")


def send_daily_digest_to_all(db: Session):
    """
    Send digest emails to all opted-in users.
    Respects each user's notification_frequency — weekly users only get emails
    on Mondays, monthly users only on the 1st.
    """
    users = (
        db.query(User)
        .filter(User.email_notifications == True, User.email != None)
        .all()
    )
    for user in users:
        try:
            freq = user.notification_frequency or "daily"
            if not _should_send_today(freq):
                continue
            window = _frequency_window(freq)
            items = _build_items_for_window(db, user.id, window)
            if items:
                send_notification_email(
                    user.email, user.username or "", items, uid=user.id, frequency=freq
                )
        except Exception as e:
            print(f"[digest] Failed for {user.email}: {e}")


@router.post("/send-digest")
def send_digest(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Trigger a digest email for the current user (uses their frequency window)."""
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email_notifications:
        raise HTTPException(status_code=400, detail="Email notifications are disabled")
    if not user.email:
        raise HTTPException(status_code=400, detail="No email address on file")

    freq = user.notification_frequency or "daily"
    window = _frequency_window(freq)
    upcoming = _build_items_for_window(db, uid, window)

    background_tasks.add_task(
        send_notification_email,
        user.email,
        user.username or "",
        upcoming,
        uid,
        frequency=freq,
    )
    return {"message": "Digest email queued"}


@router.get("/unsubscribe")
def unsubscribe(
    uid: str = Query(...),
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    expected = hmac.new(
        settings.UNSUBSCRIBE_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, token):
        raise HTTPException(status_code=400, detail="Invalid unsubscribe token")

    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.email_notifications = False
    db.commit()
    return {"message": "Unsubscribed successfully"}
