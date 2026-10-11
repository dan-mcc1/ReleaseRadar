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
