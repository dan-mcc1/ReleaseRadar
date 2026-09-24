"""Episode air-time push alerts.

For each tracked show with a known `air_time`, computes the UTC air datetime
of upcoming episodes and pushes to each opted-in tracker
`episode_alert_lead_minutes` ahead of that moment.

The scheduler (main.py) plans once an hour with plan_episode_alerts() and
sleeps until each alert is due, then calls send_planned_alert(). Polling every
few minutes instead would keep a scale-to-zero database (Neon) awake 24/7.
SentEpisodeAlert prevents double-sending across workers and restarts.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.sent_episode_alert import SentEpisodeAlert
from app.models.show import Show
from app.models.user import User
from app.models.watchlist import Watchlist
from app.services.push_service import push_notification, tmdb_poster_url

logger = logging.getLogger(__name__)

# An alert is never sent more than this late (e.g. after a restart or stall).
LATE_GRACE_SECONDS = 300
MAX_LEAD_MINUTES = 60


@dataclass(frozen=True)
class PlannedAlert:
    """One push: a user's alert for 1+ episodes of a show airing together."""

    send_at: datetime
    user_id: str
    show_id: int
    episode_ids: tuple[int, ...]
    lead: int


def _parse_air_time(value: str | None) -> time | None:
    if not value:
        return None
    # Stored as "HH:MM" or "HH:MM:SS".
    parts = value.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        return time(hour=hour, minute=minute)
    except (ValueError, IndexError):
        return None


def _air_datetime_utc(show: Show, air_date: date) -> datetime | None:
    t = _parse_air_time(show.air_time)
    if t is None:
        return None
    try:
        tz = ZoneInfo(show.air_timezone) if show.air_timezone else ZoneInfo("America/New_York")
    except (ZoneInfoNotFoundError, KeyError):
        tz = ZoneInfo("America/New_York")
    local = datetime.combine(air_date, t, tzinfo=tz)
    return local.astimezone(dt_timezone.utc)


def _trackers_by_show(db: Session, show_ids: list[int]) -> dict[int, set[str]]:
    """Users tracking each show: Watchlist with notify on, or CurrentlyWatching."""
    watchlist_rows = (
        db.query(Watchlist.user_id, Watchlist.content_id)
        .filter(
            Watchlist.content_type == "tv",
            Watchlist.content_id.in_(show_ids),
            Watchlist.notify == True,  # noqa: E712
        )
        .all()
    )
    cw_rows = (
        db.query(CurrentlyWatching.user_id, CurrentlyWatching.content_id)
        .filter(
            CurrentlyWatching.content_type == "tv",
            CurrentlyWatching.content_id.in_(show_ids),
        )
        .all()
    )
    show_to_users: dict[int, set[str]] = defaultdict(set)
    for user_id, content_id in [*watchlist_rows, *cw_rows]:
        show_to_users[content_id].add(user_id)
    return show_to_users


def _opted_in_users(db: Session, user_ids) -> dict[str, User]:
    return {
        u.id: u
        for u in db.query(User)
        .filter(
            User.id.in_(user_ids),
            User.push_notifications_enabled == True,  # noqa: E712
            User.push_notify_episode_air == True,  # noqa: E712
        )
        .all()
    }


def plan_episode_alerts(
    db: Session, window_start: datetime, window_end: datetime
) -> list[PlannedAlert]:
    """Every air-time push whose send time falls in [window_start, window_end).

    One PlannedAlert per (user, show, air time); episodes dropping together
    (e.g. a full Netflix season) share one push. Sorted by send time.
    """
    # An episode is relevant if its lead-adjusted send time can land in the
    # window: air time between window_start and window_end + the max lead.
    air_from = window_start
    air_to = window_end + timedelta(minutes=MAX_LEAD_MINUTES)
    # Episodes store a local air date; +/- a day covers every show timezone.
    first_day = air_from.date() - timedelta(days=1)
    candidate_dates = [
        first_day + timedelta(days=i)
        for i in range((air_to.date() + timedelta(days=1) - first_day).days + 1)
    ]

    rows = (
        db.query(Episode, Show)
        .join(Show, Show.id == Episode.show_id)
        .filter(Episode.air_date.in_(candidate_dates), Show.air_time.isnot(None))
        .all()
    )
    eligible_by_show: dict[int, list[tuple[Episode, datetime]]] = defaultdict(list)
    for ep, show in rows:
        air_dt = _air_datetime_utc(show, ep.air_date)
        if air_dt is not None and air_from <= air_dt < air_to:
            eligible_by_show[show.id].append((ep, air_dt))
    if not eligible_by_show:
        return []

    show_to_users = _trackers_by_show(db, list(eligible_by_show))
    relevant_user_ids = {uid for uids in show_to_users.values() for uid in uids}
    if not relevant_user_ids:
        return []
    users_by_id = _opted_in_users(db, relevant_user_ids)
    if not users_by_id:
        return []

    candidate_episode_ids = [ep.id for entries in eligible_by_show.values() for ep, _ in entries]
    already_sent = {
        (uid, eid)
        for uid, eid in db.query(SentEpisodeAlert.user_id, SentEpisodeAlert.episode_id)
        .filter(
            SentEpisodeAlert.user_id.in_(users_by_id.keys()),
            SentEpisodeAlert.episode_id.in_(candidate_episode_ids),
        )
        .all()
    }

    planned: list[PlannedAlert] = []
    for show_id, entries in eligible_by_show.items():
        for uid in show_to_users[show_id] & users_by_id.keys():
            lead = max(0, min(MAX_LEAD_MINUTES, users_by_id[uid].episode_alert_lead_minutes or 0))
            buckets: dict[datetime, list[Episode]] = defaultdict(list)
            for ep, air_dt in entries:
                send_at = air_dt - timedelta(minutes=lead)
                if (uid, ep.id) not in already_sent and window_start <= send_at < window_end:
                    buckets[air_dt].append(ep)
            for air_dt, eps in buckets.items():
                eps.sort(key=lambda e: (e.season_number or 0, e.episode_number or 0))
                planned.append(PlannedAlert(
                    send_at=air_dt - timedelta(minutes=lead),
                    user_id=uid,
                    show_id=show_id,
                    episode_ids=tuple(e.id for e in eps),
                    lead=lead,
                ))
    planned.sort(key=lambda a: a.send_at)
    return planned


def send_planned_alert(db: Session, alert: PlannedAlert) -> bool:
    """Send one planned push. Returns True if a push went out.

    Re-checks the user's settings first, so turning pushes off or muting the
    show after the hourly plan still takes effect immediately.
    """
    if not _opted_in_users(db, [alert.user_id]):
        return False
    if alert.user_id not in _trackers_by_show(db, [alert.show_id]).get(alert.show_id, set()):
        return False

    show = db.get(Show, alert.show_id)
    episodes = sorted(
        db.query(Episode).filter(Episode.id.in_(alert.episode_ids)).all(),
        key=lambda e: (e.season_number or 0, e.episode_number or 0),
    )
    if show is None or not episodes:
        return False

    # Claim each episode. Per-episode commits so a race on one episode (another
    # worker, or an overlapping sweep) doesn't lose the whole batch.
    episodes_to_send = []
    for ep in episodes:
        db.add(SentEpisodeAlert(user_id=alert.user_id, episode_id=ep.id))
        try:
            db.commit()
            episodes_to_send.append(ep)
        except IntegrityError:
            db.rollback()
    if not episodes_to_send:
        return False

    title, body = _build_push_text(show, episodes_to_send, alert.lead)
    first_ep = episodes_to_send[0]
    try:
        push_notification(
            db,
            alert.user_id,
            type="episode_air",
            title=title,
            body=body,
            content_type="tv",
            content_id=show.id,
            season_number=first_ep.season_number,
            episode_id=first_ep.id,
            image_url=tmdb_poster_url(show.poster_path),
        )
    except Exception:
        logger.exception(
            "episode-alert: push failed for user=%s show=%s eps=%s",
            alert.user_id, show.id, [e.id for e in episodes_to_send],
        )
        return False
    return True


def next_alert_window(
    now_utc: datetime, planned_until: datetime | None
) -> tuple[datetime, datetime]:
    """The next window to plan: from where the last plan stopped (never more
    than LATE_GRACE_SECONDS back) to the next top of the hour."""
    earliest = now_utc - timedelta(seconds=LATE_GRACE_SECONDS)
    start = earliest if planned_until is None else max(planned_until, earliest)
    end = now_utc.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return start, end


def dispatch_due_episode_alerts(db: Session, now_utc: datetime | None = None) -> int:
    """Send every alert due in the last LATE_GRACE_SECONDS right now.

    One-shot sweep; the scheduler in main.py plans hourly instead.
    Returns the number of pushes sent.
    """
    if now_utc is None:
        now_utc = datetime.now(dt_timezone.utc)
    window_start = now_utc - timedelta(seconds=LATE_GRACE_SECONDS)
    # +1µs keeps an alert due exactly now inside the half-open window.
    alerts = plan_episode_alerts(db, window_start, now_utc + timedelta(microseconds=1))
    return sum(send_planned_alert(db, a) for a in alerts)


def _build_push_text(
    show: Show, episodes: list[Episode], lead: int
) -> tuple[str, str]:
    """Compose the title/body for one push covering 1+ episodes of the same show.

    Multi-episode groups read as "S01E03 - S01E05" when contiguous within a
    season, "S01E03, S01E05, S01E07" otherwise. Single episodes keep the
    original "S01E03 - Episode Name" format.
    """
    count = len(episodes)
    if count == 1:
        ep = episodes[0]
        if lead == 0:
            title = f"{show.name} is on now"
        elif lead < 60:
            title = f"{show.name} airs in {lead} minutes"
        else:
            title = f"{show.name} airs in 1 hour"
        ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
        body = ep_label + (f" — {ep.name}" if ep.name else "")
        if ep.runtime:
            body += f" • {ep.runtime} min"
        return title, body

    # Multi-episode group
    if lead == 0:
        title = f"{count} new episodes of {show.name}"
    elif lead < 60:
        title = f"{count} new episodes of {show.name} in {lead} min"
    else:
        title = f"{count} new episodes of {show.name} in 1 hour"

    same_season = all(
        e.season_number == episodes[0].season_number for e in episodes
    )
    ep_nums = [e.episode_number for e in episodes if e.episode_number is not None]
    contiguous = (
        same_season
        and len(ep_nums) == count
        and ep_nums == list(range(ep_nums[0], ep_nums[0] + count))
    )

    if contiguous:
        s = episodes[0].season_number
        body = (
            f"S{s:02d}E{ep_nums[0]:02d} – S{s:02d}E{ep_nums[-1]:02d}"
        )
    else:
        labels = [
            f"S{e.season_number:02d}E{e.episode_number:02d}" for e in episodes
        ]
        # Cap visible labels so the iOS preview doesn't truncate awkwardly.
        if len(labels) > 4:
            body = ", ".join(labels[:3]) + f" +{len(labels) - 3} more"
        else:
            body = ", ".join(labels)
    return title, body
