"""
The daily digest and season-premiere alerts. Each hour a dispatcher queues
one job per user who's due, keyed by user and day, and each job sends at
most once for that day.
"""
import logging
from datetime import date, datetime, timezone

from durable_queue.sqlalchemy import enqueue_many

from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.models.sent_premiere_alert import SentPremiereAlert
from app.models.user import User
from app.services.digest_service import (
    _build_items_for_window,
    _frequency_window,
    digest_due,
    due_date,
    pending_premiere_alerts,
    premiere_eligible,
    premiere_push_text,
)
from app.services.email_service import send_notification_email, send_season_premiere_email
from app.services.episode_alert_service import (
    LATE_GRACE_SECONDS,
    PlannedAlert,
    next_alert_window,
    plan_episode_alerts,
    send_planned_alert,
)
from app.services.push_service import push_notification, tmdb_poster_url

logger = logging.getLogger(__name__)


@logged_task
def dispatch_digests() -> None:
    """Queue send_digest for every user whose digest is due this hour. Keyed
    by user and day, so a user still in their window next hour isn't queued
    again."""
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        users = (
            db.query(User)
            .filter(User.email_notifications == True, User.email.isnot(None))  # noqa: E712
            .all()
        )
        due = []
        for user in users:
            day = digest_due(user, now)
            if day is not None:
                due.append((user.id, day.isoformat()))
        enqueue_many(
            db,
            "send_digest",
            [{"user_id": user_id, "digest_date": day} for user_id, day in due],
            idempotency_keys=[f"digest:{user_id}:{day}" for user_id, day in due],
        )
        db.commit()
        logger.info("digest: queued %d user(s)", len(due))
    finally:
        db.close()


@logged_task
def send_digest(user_id: str, digest_date: str) -> None:
    """
    Send one user's digest for digest_date, then mark it sent. The Resend key
    is the same on every attempt, so a retry after a send that went through
    doesn't deliver it twice.
    """
    day = date.fromisoformat(digest_date)
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None or not user.email_notifications or not user.email:
            return
        if user.last_digest_sent_at is not None and user.last_digest_sent_at >= day:
            return
        frequency = user.notification_frequency or "daily"
        items = _build_items_for_window(db, user.id, _frequency_window(frequency))
        if not items:
            return
        send_notification_email(
            user.email,
            user.username or "",
            items,
            uid=user.id,
            frequency=frequency,
            idempotency_key=f"digest:{user.id}:{digest_date}",
        )
        user.last_digest_sent_at = day
        db.commit()
    finally:
        db.close()


@logged_task
def dispatch_premiere_alerts() -> None:
    """Queue send_premiere_alerts for every premium user in their digest
    window. Keyed by user and day."""
    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        users = (
            db.query(User)
            .filter(
                User.notify_new_seasons == True,  # noqa: E712
                User.subscription_tier.in_(["premium", "admin"]),
            )
            .all()
        )
        due = []
        for user in users:
            day = due_date(user, now)
            if day is not None and premiere_eligible(user):
                due.append((user.id, day.isoformat()))
        enqueue_many(
            db,
            "send_premiere_alerts",
            [{"user_id": user_id, "alert_date": day} for user_id, day in due],
            idempotency_keys=[f"premiere:{user_id}:{day}" for user_id, day in due],
        )
        db.commit()
        logger.info("premiere alerts: queued %d user(s)", len(due))
    finally:
        db.close()


@logged_task
def send_premiere_alerts(user_id: str, alert_date: str) -> None:
    """
    Email the user's pending premiere alerts, record them, then push them.
    The email's Resend key makes a retry before the record safe. Pushes go
    out only for alerts this run recorded, so a crash after recording loses
    them rather than sending them twice.
    """
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None or not premiere_eligible(user):
            return
        alerts = pending_premiere_alerts(db, user, date.fromisoformat(alert_date))
        if not alerts:
            return
        if user.email_notifications and user.email:
            send_season_premiere_email(
                user.email,
                user.username or "",
                alerts,
                uid=user.id,
                idempotency_key=f"premiere:{user.id}:{alert_date}",
            )
        for alert in alerts:
            db.add(SentPremiereAlert(
                user_id=user.id,
                show_id=alert["show_id"],
                season_number=alert["season_number"],
                lead_days=alert["lead_days"],
            ))
        db.commit()
        if user.push_notifications_enabled and user.push_notify_new_seasons:
            for alert in alerts:
                title, body = premiere_push_text(alert)
                try:
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
                    logger.exception(
                        "premiere alerts: push failed for user %s show %s",
                        user.id, alert["show_id"],
                    )
    finally:
        db.close()


@logged_task
def send_episode_alert(
    user_id: str, show_id: int, episode_ids: list[int], lead: int, send_at: str
) -> None:
    """
    Push one planned episode alert at its time (the job's run_at). Skipped if
    more than LATE_GRACE_SECONDS late: a "starting now" push long after the
    episode started is worse than none. send_planned_alert re-checks the
    user's settings and claims each episode first, so a retry never pushes
    twice.
    """
    when = datetime.fromisoformat(send_at)
    late = (datetime.now(timezone.utc) - when).total_seconds()
    if late > LATE_GRACE_SECONDS:
        logger.info(
            "episode alert: skipped user %s show %s, %.0fs late", user_id, show_id, late
        )
        return
    db = SessionLocal()
    try:
        send_planned_alert(db, PlannedAlert(
            send_at=when,
            user_id=user_id,
            show_id=show_id,
            episode_ids=tuple(episode_ids),
            lead=lead,
        ))
    finally:
        db.close()


@logged_task
def dispatch_episode_alerts() -> None:
    """
    Plan the hour's episode air-time pushes and queue each as a job held
    until its send time. Planned from 5 minutes ago, so consecutive hours
    overlap; the key stops an alert being queued twice. Between plan and
    send the worker sleeps, so Neon can too.
    """
    window_start, window_end = next_alert_window(datetime.now(timezone.utc), None)
    db = SessionLocal()
    try:
        alerts = plan_episode_alerts(db, window_start, window_end)
        enqueue_many(
            db,
            "send_episode_alert",
            [
                {
                    "user_id": alert.user_id,
                    "show_id": alert.show_id,
                    "episode_ids": list(alert.episode_ids),
                    "lead": alert.lead,
                    "send_at": alert.send_at.isoformat(),
                }
                for alert in alerts
            ],
            idempotency_keys=[
                f"episode-alert:{alert.user_id}:{alert.show_id}:{alert.send_at.isoformat()}"
                for alert in alerts
            ],
            run_ats=[alert.send_at for alert in alerts],
        )
        db.commit()
        logger.info("episode alerts: queued %d push(es)", len(alerts))
    finally:
        db.close()
