import hmac
import hashlib
import logging
from datetime import date, datetime, timedelta, timezone as dt_timezone
from collections import defaultdict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import is_premium
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.models.season import Season
from app.models.episode import Episode
from app.models.notification import Notification as NotificationModel
from app.services import push_service
from app.services.push_service import tmdb_poster_url
from app.services.email_service import (
    send_notification_email,
    send_season_premiere_email,
    format_air_time,
)
from app.services.push_service import push_notification
from app.config import settings
from app.core.limiter import limiter

router = APIRouter()

logger = logging.getLogger(__name__)

VALID_FREQUENCIES = {"daily", "weekly", "monthly"}
VALID_VISIBILITIES = {"public", "friends_only", "private"}


class PreferencesUpdate(BaseModel):
    email_notifications: bool | None = None
    notification_frequency: str | None = None
    profile_visibility: str | None = None
    notify_new_seasons: bool | None = None
    notify_streaming_changes: bool | None = None
    notify_trailers: bool | None = None
    digest_hour: int | None = None
    digest_timezone: str | None = None
    hide_spoilers: bool | None = None
    push_notifications_enabled: bool | None = None
    push_notify_new_seasons: bool | None = None
    push_notify_streaming_changes: bool | None = None
    push_notify_trailers: bool | None = None
    push_notify_episode_air: bool | None = None
    episode_alert_lead_minutes: int | None = None


class DeviceRegister(BaseModel):
    token: str
    platform: str  # 'ios' | 'android'
    app_version: str | None = None


class DeviceUnregister(BaseModel):
    token: str


class MarkReadBody(BaseModel):
    ids: list[int] | None = None  # null = mark all


class DeleteInboxBody(BaseModel):
    ids: list[int] | None = None  # null = delete all


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
        "notify_new_seasons": user.notify_new_seasons,
        "notify_streaming_changes": user.notify_streaming_changes,
        "notify_trailers": user.notify_trailers,
        "digest_hour": user.digest_hour if user.digest_hour is not None else 9,
        "digest_timezone": user.digest_timezone or "America/New_York",
        "hide_spoilers": user.hide_spoilers,
        "push_notifications_enabled": user.push_notifications_enabled,
        "push_notify_new_seasons": user.push_notify_new_seasons,
        "push_notify_streaming_changes": user.push_notify_streaming_changes,
        "push_notify_trailers": user.push_notify_trailers,
        "push_notify_episode_air": user.push_notify_episode_air,
        "episode_alert_lead_minutes": user.episode_alert_lead_minutes,
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

    if body.notify_new_seasons is not None:
        if body.notify_new_seasons and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_new_seasons = body.notify_new_seasons

    if body.notify_streaming_changes is not None:
        if body.notify_streaming_changes and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_streaming_changes = body.notify_streaming_changes

    if body.notify_trailers is not None:
        if body.notify_trailers and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "premium_required",
                    "message": "This feature requires a Premium subscription.",
                },
            )
        user.notify_trailers = body.notify_trailers

    if body.digest_hour is not None:
        if not (0 <= body.digest_hour <= 23):
            raise HTTPException(status_code=422, detail="digest_hour must be between 0 and 23")
        user.digest_hour = body.digest_hour

    if body.digest_timezone is not None:
        try:
            ZoneInfo(body.digest_timezone)
        except (ZoneInfoNotFoundError, KeyError):
            raise HTTPException(status_code=422, detail="Invalid timezone")
        user.digest_timezone = body.digest_timezone

    if body.hide_spoilers is not None:
        user.hide_spoilers = body.hide_spoilers

    if body.push_notifications_enabled is not None:
        user.push_notifications_enabled = body.push_notifications_enabled

    if body.push_notify_new_seasons is not None:
        if body.push_notify_new_seasons and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_new_seasons = body.push_notify_new_seasons

    if body.push_notify_streaming_changes is not None:
        if body.push_notify_streaming_changes and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_streaming_changes = body.push_notify_streaming_changes

    if body.push_notify_trailers is not None:
        if body.push_notify_trailers and not is_premium(uid, db):
            raise HTTPException(
                status_code=403,
                detail={"error": "premium_required", "message": "This feature requires a Premium subscription."},
            )
        user.push_notify_trailers = body.push_notify_trailers

    if body.push_notify_episode_air is not None:
        user.push_notify_episode_air = body.push_notify_episode_air

    if body.episode_alert_lead_minutes is not None:
        lead = body.episode_alert_lead_minutes
        if lead < 0 or lead > 60 or lead % 15 != 0:
            raise HTTPException(
                status_code=422,
                detail="episode_alert_lead_minutes must be 0, 15, 30, 45, or 60",
            )
        user.episode_alert_lead_minutes = lead

    db.commit()
    return {
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency,
        "profile_visibility": user.profile_visibility,
        "notify_new_seasons": user.notify_new_seasons,
        "notify_streaming_changes": user.notify_streaming_changes,
        "notify_trailers": user.notify_trailers,
        "digest_hour": user.digest_hour,
        "digest_timezone": user.digest_timezone,
        "hide_spoilers": user.hide_spoilers,
        "push_notifications_enabled": user.push_notifications_enabled,
        "push_notify_new_seasons": user.push_notify_new_seasons,
        "push_notify_streaming_changes": user.push_notify_streaming_changes,
        "push_notify_trailers": user.push_notify_trailers,
        "push_notify_episode_air": user.push_notify_episode_air,
        "episode_alert_lead_minutes": user.episode_alert_lead_minutes,
    }


# ---------------------------------------------------------------------------
# Device tokens (iOS APNs via FCM)
# ---------------------------------------------------------------------------

@router.post("/devices/register")
def register_device(
    body: DeviceRegister,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Register an FCM token for the current user. Idempotent on `token`."""
    platform = body.platform.lower()
    if platform not in {"ios", "android"}:
        raise HTTPException(status_code=422, detail="platform must be 'ios' or 'android'")
    if not body.token or len(body.token) > 4096:
        raise HTTPException(status_code=422, detail="invalid token")

    push_service.register_device(
        db, uid, body.token, platform, app_version=body.app_version
    )
    # Auto-enable push the first time a device shows up — explicit toggle is
    # available in /preferences if the user wants to turn it back off.
    user = db.get(User, uid)
    if user and not user.push_notifications_enabled:
        user.push_notifications_enabled = True
        db.commit()
    return {"ok": True, "badge": push_service.unread_count(db, uid)}


@router.post("/devices/unregister")
def unregister_device(
    body: DeviceUnregister,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),  # noqa: ARG001 — auth gate only
):
    push_service.unregister_device(db, body.token)
    return {"ok": True}


# ---------------------------------------------------------------------------
# In-app inbox + badge
# ---------------------------------------------------------------------------

@router.get("/inbox")
def list_inbox(
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None),
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    q = db.query(NotificationModel).filter(NotificationModel.user_id == uid)
    if unread_only:
        q = q.filter(NotificationModel.read_at.is_(None))
    if before_id is not None:
        q = q.filter(NotificationModel.id < before_id)
    rows = q.order_by(NotificationModel.id.desc()).limit(limit).all()
    return {
        "items": [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "body": n.body,
                "content_type": n.content_type,
                "content_id": n.content_id,
                "image_url": n.image_url,
                "season_number": n.season_number,
                "episode_id": n.episode_id,
                "video_key": n.video_key,
                "recommendation_id": n.recommendation_id,
                "friendship_id": n.friendship_id,
                "read_at": n.read_at.isoformat() if n.read_at else None,
                "created_at": n.created_at.isoformat(),
            }
            for n in rows
        ],
        "badge": push_service.unread_count(db, uid),
    }


@router.get("/badge")
def get_badge(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return {"badge": push_service.unread_count(db, uid)}


@router.post("/inbox/read")
def mark_inbox_read(
    body: MarkReadBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    new_badge = push_service.mark_read(db, uid, body.ids)
    # Best-effort silent push so the user's other devices update their badge.
    try:
        push_service.refresh_badge(db, uid)
    except Exception:
        logger.exception("badge refresh push failed for %s", uid)
    return {"badge": new_badge}


@router.post("/inbox/delete")
def delete_inbox(
    body: DeleteInboxBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Permanently remove inbox entries. Only deletes rows belonging to the
    current user. Does NOT touch the underlying recommendation / friendship /
    invitation row — those have their own dedicated actions; this is just
    'clear it from my inbox'."""
    q = db.query(NotificationModel).filter(NotificationModel.user_id == uid)
    if body.ids is not None:
        if not body.ids:
            return {"badge": push_service.unread_count(db, uid), "deleted": 0}
        q = q.filter(NotificationModel.id.in_(body.ids))
    deleted = q.delete(synchronize_session=False)
    db.commit()

    new_badge = push_service.unread_count(db, uid)
    # Best-effort silent push so other devices update their badge.
    try:
        push_service.refresh_badge(db, uid)
    except Exception:
        logger.exception("badge refresh push failed for %s", uid)
    return {"badge": new_badge, "deleted": deleted}


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


def _build_items_for_bucket(
    db: Session, user_ids: list[str], days: int
) -> dict[str, list]:
    """
    Bulk version of _build_items_for_window for a set of users sharing the same
    look-ahead window. Returns {user_id: [item, ...]} in two passes (movies,
    then TV) instead of N×3 per-user queries.
    """
    if not user_ids:
        return {}

    today = date.today()
    end = today + timedelta(days=days)
    results: dict[str, list] = {uid: [] for uid in user_ids}

    # --- Movies ---
    movie_rows = (
        db.query(Watchlist.user_id, Movie)
        .join(Movie, Movie.id == Watchlist.content_id)
        .filter(
            Watchlist.user_id.in_(user_ids),
            Watchlist.content_type == "movie",
            Watchlist.notify == True,  # noqa: E712
            Movie.release_date >= today,
            Movie.release_date < end,
        )
        .all()
    )
    for user_id, m in movie_rows:
        results[user_id].append(
            {
                "title": m.title,
                "date": str(m.release_date),
                "content_type": "movie",
                "content_id": m.id,
                "poster_path": m.poster_path,
            }
        )

    # --- TV episodes ---
    # Collect tracked show IDs per user across both Watchlist and CurrentlyWatching.
    watchlist_tv = (
        db.query(Watchlist.user_id, Watchlist.content_id)
        .filter(
            Watchlist.user_id.in_(user_ids),
            Watchlist.content_type == "tv",
            Watchlist.notify == True,  # noqa: E712
        )
        .all()
    )
    cw_tv = (
        db.query(CurrentlyWatching.user_id, CurrentlyWatching.content_id)
        .filter(
            CurrentlyWatching.user_id.in_(user_ids),
            CurrentlyWatching.content_type == "tv",
        )
        .all()
    )

    user_show_ids: dict[str, set[int]] = defaultdict(set)
    for user_id, content_id in watchlist_tv:
        user_show_ids[user_id].add(content_id)
    for user_id, content_id in cw_tv:
        user_show_ids[user_id].add(content_id)

    all_show_ids = {sid for sids in user_show_ids.values() for sid in sids}
    if not all_show_ids:
        return results

    episode_rows = (
        db.query(Episode, Show)
        .join(Show, Show.id == Episode.show_id)
        .filter(
            Episode.show_id.in_(all_show_ids),
            Episode.air_date >= today,
            Episode.air_date < end,
        )
        .all()
    )

    # Index by show_id so each user→show lookup is O(1).
    show_episodes: dict[int, list] = defaultdict(list)
    for ep, show in episode_rows:
        show_episodes[ep.show_id].append((ep, show))

    for user_id, show_ids in user_show_ids.items():
        for show_id in show_ids:
            for ep, show in show_episodes.get(show_id, []):
                results[user_id].append(
                    {
                        "title": (
                            f"{show.name} S{ep.season_number:02d}E{ep.episode_number:02d}"
                            + (f" — {ep.name}" if ep.name else "")
                        ),
                        "date": str(ep.air_date),
                        "air_time": format_air_time(show.air_time, show.air_timezone),
                        "content_type": "tv",
                        "content_id": show.id,
                        "poster_path": show.poster_path,
                        "episode_type": ep.episode_type,
                    }
                )

    return results


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


def _user_local_now(user: User, now_utc: datetime) -> datetime:
    try:
        tz = ZoneInfo(user.digest_timezone or "America/New_York")
    except (ZoneInfoNotFoundError, KeyError):
        tz = ZoneInfo("America/New_York")
    return now_utc.astimezone(tz)


def send_season_premiere_alerts_to_all(db: Session, now_utc: datetime | None = None):
    """
    Runs every hour alongside the digest sweep. Sends season-premiere alerts
    only to users whose local clock has just reached their preferred digest_hour.
    """
    if now_utc is None:
        now_utc = datetime.now(dt_timezone.utc)

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

    # Bulk-load shows for all upcoming seasons in one query
    upcoming_show_ids = list({s.show_id for s in upcoming_seasons})
    shows_by_id = {
        s.id: s for s in db.query(Show).filter(Show.id.in_(upcoming_show_ids)).all()
    }

    # Map show_id -> list of alert dicts
    show_alerts: dict[int, list] = defaultdict(list)
    date_to_days = {dt: d for d, dt in target_dates.items()}
    for season in upcoming_seasons:
        show = shows_by_id.get(season.show_id)
        if not show:
            continue
        days_away = date_to_days[season.air_date]
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

    affected_show_ids = list(show_alerts.keys())

    # Bulk-load tracking rows; only include watchlist items where notify=True
    watchlist_rows = (
        db.query(Watchlist.user_id, Watchlist.content_id)
        .filter(
            Watchlist.content_type == "tv",
            Watchlist.content_id.in_(affected_show_ids),
            Watchlist.notify == True,  # noqa: E712
        )
        .all()
    )
    watched_rows = (
        db.query(Watched.user_id, Watched.content_id)
        .filter(Watched.content_type == "tv", Watched.content_id.in_(affected_show_ids))
        .all()
    )

    # Map user_id -> set of tracked show_ids
    user_tracked: dict[str, set] = defaultdict(set)
    for user_id, content_id in watchlist_rows:
        user_tracked[user_id].add(content_id)
    for user_id, content_id in watched_rows:
        user_tracked[user_id].add(content_id)

    # Find all opted-in users who track at least one affected show.
    # We pull anyone opted in to *either* email or push for this event type;
    # the per-channel checks below decide what actually gets sent.
    relevant_user_ids = list(user_tracked.keys())
    users = (
        db.query(User)
        .filter(
            User.id.in_(relevant_user_ids),
            User.notify_new_seasons == True,  # noqa: E712
            User.subscription_tier.in_(["premium", "admin"]),
        )
        .all()
    )

    for user in users:
        try:
            local_now = _user_local_now(user, now_utc)
            preferred_hour = user.digest_hour if user.digest_hour is not None else 9
            if local_now.hour != preferred_hour:
                continue
            tracked = user_tracked[user.id]
            alerts = [
                alert
                for show_id in affected_show_ids
                if show_id in tracked
                for alert in show_alerts[show_id]
            ]
            if not alerts:
                continue

            if user.email_notifications and user.email:
                send_season_premiere_email(
                    user.email, user.username or "", alerts, uid=user.id
                )

            if user.push_notifications_enabled and user.push_notify_new_seasons:
                for alert in alerts:
                    days = alert["days_away"]
                    when = "today" if days == 0 else f"in {days} days"
                    title = f"New season of {alert['show_name']} {when}"
                    season_label = (
                        alert.get("season_name") or f"Season {alert['season_number']}"
                    )
                    body = f"{season_label} airs {alert['air_date']}"
                    push_notification(
                        db,
                        user.id,
                        type="season_premiere",
                        title=title,
                        body=body,
                        content_type="tv",
                        content_id=alert["show_id"],
                        season_number=alert["season_number"],
                        image_url=tmdb_poster_url(alert.get("poster_path")),
                    )
        except Exception:
            logger.exception("Season alert failed for user %s", user.id)


def send_daily_digest_to_all(db: Session, now_utc: datetime | None = None):
    """
    Runs every hour. All hour/date/frequency filtering happens in a single SQL
    query so Python only sees the small bucket of users who actually need a
    digest right now. Items are then fetched in bulk (one query per frequency
    group) instead of N per-user queries.
    """
    # All timezone arithmetic runs in the DB. digest_timezones must be valid
    # IANA names; the preferences endpoint enforces this on write.
    bucket_sql = text("""
        SELECT
            id,
            email,
            username,
            notification_frequency,
            digest_timezone,
            (NOW() AT TIME ZONE COALESCE(digest_timezone, 'America/New_York'))::date
                AS local_date
        FROM "user"
        WHERE email_notifications
          AND email IS NOT NULL
          AND ((COALESCE(digest_hour, 9)
                - EXTRACT(HOUR FROM (NOW() AT TIME ZONE COALESCE(digest_timezone, 'America/New_York')))::int
               ) % 24) = 0
          AND (
            last_digest_sent_at IS NULL
            OR last_digest_sent_at
               < (NOW() AT TIME ZONE COALESCE(digest_timezone, 'America/New_York'))::date
          )
          AND (
            COALESCE(notification_frequency, 'daily') = 'daily'
            OR (COALESCE(notification_frequency, 'daily') = 'weekly'
                AND EXTRACT(DOW FROM (NOW() AT TIME ZONE COALESCE(digest_timezone, 'America/New_York'))) = 1)
            OR (COALESCE(notification_frequency, 'daily') = 'monthly'
                AND EXTRACT(DAY FROM (NOW() AT TIME ZONE COALESCE(digest_timezone, 'America/New_York'))) = 1)
          )
    """)

    rows = db.execute(bucket_sql).mappings().all()
    if not rows:
        return

    # Group by frequency so we can run one bulk-items query per window size.
    freq_groups: dict[str, list] = defaultdict(list)
    for row in rows:
        freq = row["notification_frequency"] or "daily"
        freq_groups[freq].append(row)

    all_items: dict[str, list] = {}
    for freq, freq_rows in freq_groups.items():
        window = _frequency_window(freq)
        user_ids = [r["id"] for r in freq_rows]
        all_items.update(_build_items_for_bucket(db, user_ids, window))

    # Send emails; collect IDs to batch-mark as sent afterwards.
    updates: list[tuple[str, date]] = []
    for row in rows:
        user_id = row["id"]
        items = all_items.get(user_id, [])
        if not items:
            continue
        try:
            send_notification_email(
                row["email"],
                row["username"] or "",
                items,
                uid=user_id,
                frequency=row["notification_frequency"] or "daily",
            )
            updates.append((user_id, row["local_date"]))
        except Exception:
            logger.exception("Daily digest failed for user %s", user_id)

    if updates:
        for user_id, local_date in updates:
            db.query(User).filter_by(id=user_id).update(
                {"last_digest_sent_at": local_date}, synchronize_session=False
            )
        db.commit()


@router.post("/send-digest")
@limiter.limit("3/hour")
def send_digest(
    request: Request,
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
