"""Episode air-time push alerts.

Runs every 5 minutes. For each tracked show with a known `air_time`,
computes the UTC air datetime for each episode airing today and fires a
push to each opted-in tracker `episode_alert_lead_minutes` ahead of that
moment. SentEpisodeAlert prevents double-sending if the loop overlaps
with another tick.
"""

import logging
from collections import defaultdict
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

# Sweep cadence — keep this matched to the 5-minute lead-time granularity.
SWEEP_INTERVAL_SECONDS = 300


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


def dispatch_due_episode_alerts(db: Session, now_utc: datetime | None = None) -> int:
    """Returns the number of pushes sent in this sweep."""
    if now_utc is None:
        now_utc = datetime.now(dt_timezone.utc)

    # Window = the sweep interval. An episode is "due" if its lead-adjusted
    # send time falls anywhere in [now - interval, now]. That gives at-most-once
    # delivery per episode (guarded by SentEpisodeAlert) even if a tick is late.
    window_start = now_utc - timedelta(seconds=SWEEP_INTERVAL_SECONDS)

    # Bound the SQL scan: today and tomorrow in UTC cover every show timezone.
    today_utc = now_utc.date()
    candidate_dates = [today_utc - timedelta(days=1), today_utc, today_utc + timedelta(days=1)]

    rows = (
        db.query(Episode, Show)
        .join(Show, Show.id == Episode.show_id)
        .filter(Episode.air_date.in_(candidate_dates), Show.air_time.isnot(None))
        .all()
    )
    if not rows:
        return 0

    # Map show_id -> [(episode, air_dt_utc), ...] for episodes whose air time
    # is anywhere within the next 65 minutes (max lead) or the recent past window.
    # Filtering here keeps the per-user loop tight.
    horizon = now_utc + timedelta(minutes=65)
    eligible_by_show: dict[int, list[tuple[Episode, Show, datetime]]] = defaultdict(list)
    for ep, show in rows:
        air_dt = _air_datetime_utc(show, ep.air_date)
        if air_dt is None:
            continue
        if air_dt < window_start - timedelta(minutes=65) or air_dt > horizon:
            continue
        eligible_by_show[show.id].append((ep, show, air_dt))

    if not eligible_by_show:
        return 0

    show_ids = list(eligible_by_show.keys())

    # Trackers: Watchlist (notify=true) + CurrentlyWatching.
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
    for user_id, content_id in watchlist_rows:
        show_to_users[content_id].add(user_id)
    for user_id, content_id in cw_rows:
        show_to_users[content_id].add(user_id)

    relevant_user_ids = {uid for uids in show_to_users.values() for uid in uids}
    if not relevant_user_ids:
        return 0

    users_by_id = {
        u.id: u
        for u in db.query(User)
        .filter(
            User.id.in_(relevant_user_ids),
            User.push_notifications_enabled == True,  # noqa: E712
            User.push_notify_episode_air == True,  # noqa: E712
        )
        .all()
    }
    if not users_by_id:
        return 0

    # Skip episodes we've already alerted for, per (user, episode).
    candidate_episode_ids = [
        ep.id for entries in eligible_by_show.values() for ep, _, _ in entries
    ]
    already_sent = {
        (uid, eid)
        for uid, eid in db.query(SentEpisodeAlert.user_id, SentEpisodeAlert.episode_id)
        .filter(
            SentEpisodeAlert.user_id.in_(users_by_id.keys()),
            SentEpisodeAlert.episode_id.in_(candidate_episode_ids),
        )
        .all()
    }

    sent_count = 0
    for show_id, entries in eligible_by_show.items():
        tracker_ids = show_to_users[show_id] & users_by_id.keys()
        if not tracker_ids:
            continue

        for uid in tracker_ids:
            user = users_by_id[uid]
            lead = max(0, min(60, user.episode_alert_lead_minutes or 0))

            # Group this user's not-yet-sent, due episodes for this show by
            # air_dt. Same air_dt → one combined push (e.g., Netflix drops 8
            # episodes at midnight → one banner, not eight).
            buckets: dict[datetime, list[tuple[Episode, Show]]] = defaultdict(list)
            for ep, show, air_dt in entries:
                if (uid, ep.id) in already_sent:
                    continue
                send_at = air_dt - timedelta(minutes=lead)
                if not (window_start <= send_at <= now_utc):
                    continue
                buckets[air_dt].append((ep, show))

            for items in buckets.values():
                # Sort by (season, episode) so the body reads in order.
                items.sort(
                    key=lambda pair: (
                        pair[0].season_number or 0,
                        pair[0].episode_number or 0,
                    )
                )
                episodes_to_send = []
                show = items[0][1]

                # Claim each episode in the group. Per-episode commits so a
                # race on one episode doesn't lose the whole batch.
                for ep, _ in items:
                    db.add(SentEpisodeAlert(user_id=uid, episode_id=ep.id))
                    try:
                        db.commit()
                        episodes_to_send.append(ep)
                    except IntegrityError:
                        db.rollback()
                        # Another worker beat us to this episode; the rest of
                        # the batch is still ours.

                if not episodes_to_send:
                    continue

                title, body = _build_push_text(show, episodes_to_send, lead)
                first_ep = episodes_to_send[0]
                try:
                    push_notification(
                        db,
                        uid,
                        type="episode_air",
                        title=title,
                        body=body,
                        content_type="tv",
                        content_id=show.id,
                        season_number=first_ep.season_number,
                        episode_id=first_ep.id,
                        image_url=tmdb_poster_url(show.poster_path),
                    )
                    sent_count += 1
                except Exception:
                    logger.exception(
                        "episode-alert: push failed for user=%s show=%s eps=%s",
                        uid, show.id, [e.id for e in episodes_to_send],
                    )

    return sent_count


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
