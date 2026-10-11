"""Who gets the daily digest and season-premiere alerts, and when."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select, union
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.movie import Movie
from app.models.season import Season
from app.models.sent_premiere_alert import SentPremiereAlert
from app.models.show import Show
from app.models.watched import Watched
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


def premiere_eligible(user) -> bool:
    """Premium users who want season-premiere alerts on at least one channel."""
    if user.subscription_tier not in ("premium", "admin") or not user.notify_new_seasons:
        return False
    return bool(
        (user.email_notifications and user.email)
        or (user.push_notifications_enabled and user.push_notify_new_seasons)
    )


def pending_premiere_alerts(db: Session, user, alert_date: date) -> list[dict]:
    """
    Season-premiere alerts due to the user on alert_date and not sent yet.
    The 30-day alert covers seasons 30 to 8 days away, the 7-day alert 7 to 1
    days away; each goes out once. A show counts as tracked from the
    Watchlist (with notify on) or the Watched list.
    """
    tracked = union(
        select(Watchlist.content_id).where(
            Watchlist.user_id == user.id,
            Watchlist.content_type == "tv",
            Watchlist.notify == True,  # noqa: E712
        ),
        select(Watched.content_id).where(
            Watched.user_id == user.id, Watched.content_type == "tv"
        ),
    ).subquery()
    rows = (
        db.query(Season, Show)
        .join(Show, Show.id == Season.show_id)
        .filter(
            Season.show_id.in_(select(tracked.c.content_id)),
            Season.season_number > 0,
            Season.air_date > alert_date,
            Season.air_date <= alert_date + timedelta(days=30),
        )
        .order_by(Season.show_id, Season.season_number, Season.air_date)
        .all()
    )
    sent = {
        (a.show_id, a.season_number, a.lead_days)
        for a in db.query(SentPremiereAlert).filter_by(user_id=user.id)
    }
    alerts, seen = [], set()
    for season, show in rows:
        if (season.show_id, season.season_number) in seen:
            continue  # a second Season row for one season (TMDb reissued its id)
        seen.add((season.show_id, season.season_number))
        days_away = (season.air_date - alert_date).days
        lead_days = 30 if days_away >= 8 else 7
        if (season.show_id, season.season_number, lead_days) in sent:
            continue
        alerts.append({
            "show_name": show.name,
            "season_number": season.season_number,
            "season_name": season.name,
            "air_date": str(season.air_date),
            "days_away": days_away,
            "lead_days": lead_days,
            "show_id": show.id,
            "poster_path": show.poster_path,
        })
    return alerts


def premiere_push_text(alert: dict) -> tuple[str, str]:
    """The push title and body for one premiere alert."""
    days = alert["days_away"]
    if days == 0:
        when = "today"
    elif days == 1:
        when = "in 1 day"
    else:
        when = f"in {days} days"
    title = f"A new season of {alert['show_name']} airs {when}"
    season_label = alert.get("season_name") or f"Season {alert['season_number']}"
    air_dt = date.fromisoformat(alert["air_date"])
    body = f"{season_label} releases on {air_dt.strftime('%B')} {air_dt.day}, {air_dt.year}"
    return title, body
