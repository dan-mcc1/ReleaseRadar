"""Who gets the daily digest and season-premiere alerts, and when."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.movie import Movie
from app.models.show import Show
from app.models.watchlist import Watchlist
from app.services.email_service import format_air_time

# How long after a user's digest_hour they can still get that day's digest
# and premiere alerts, after downtime say. Not into the night: premiere
# alerts include pushes.
DUE_WINDOW = timedelta(hours=6)
DEFAULT_TIMEZONE = "America/New_York"


def _build_items_for_window(db: Session, user_id: str, days: int) -> list:
    """Find watchlisted movies/shows releasing within the next `days` days."""
    today = date.today()
    end = today + timedelta(days=days)
    upcoming = []

    movies = (
        db.query(Movie)
        .join(
            Watchlist,
            (Watchlist.content_id == Movie.id) & (Watchlist.content_type == "movie"),
        )
        .filter(
            Watchlist.user_id == user_id,
            Watchlist.notify == True,  # noqa: E712
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

    # Collect tracked show IDs, respecting per-item notify flag on Watchlist
    tracked_show_ids = {
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter(
            Watchlist.user_id == user_id,
            Watchlist.content_type == "tv",
            Watchlist.notify == True,  # noqa: E712
        )
        .all()
    } | {
        r.content_id
        for r in db.query(CurrentlyWatching.content_id)
        .filter_by(user_id=user_id, content_type="tv")
        .all()
    }

    if tracked_show_ids:
        episodes = (
            db.query(Episode, Show)
            .join(Show, Show.id == Episode.show_id)
            .filter(
                Episode.show_id.in_(tracked_show_ids),
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

    return upcoming


def _frequency_window(frequency: str) -> int:
    """Return the number of days to look ahead for a given frequency."""
    return {"daily": 1, "weekly": 7, "monthly": 30}.get(frequency, 1)


def _should_send_today(frequency: str, local_date: date | None = None) -> bool:
    """Return True if the digest should be sent today for the given frequency."""
    today = local_date if local_date is not None else date.today()
    if frequency == "daily":
        return True
    if frequency == "weekly":
        return today.weekday() == 0  # Monday
    if frequency == "monthly":
        return today.day == 1
    return False


def _user_tz(user) -> ZoneInfo:
    try:
        return ZoneInfo(user.digest_timezone or DEFAULT_TIMEZONE)
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def due_date(user, now_utc: datetime) -> date | None:
    """The local date whose digest window now_utc falls in: from the user's
    digest_hour until DUE_WINDOW after it, on their clock. None outside it."""
    local_now = now_utc.astimezone(_user_tz(user))
    hour = user.digest_hour if user.digest_hour is not None else 9
    slot = local_now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if slot > local_now:
        slot -= timedelta(days=1)  # a window that crosses midnight
    return slot.date() if local_now - slot < DUE_WINDOW else None


def digest_due(user, now_utc: datetime) -> date | None:
    """The date to send this user's digest for, if one is due now."""
    if not user.email_notifications or not user.email:
        return None
    day = due_date(user, now_utc)
    if day is None or not _should_send_today(user.notification_frequency or "daily", day):
        return None
    if user.last_digest_sent_at is not None and user.last_digest_sent_at >= day:
        return None
    return day
