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
from app.models.user import User
from app.services.digest_service import (
    _build_items_for_window,
    _frequency_window,
    digest_due,
)
from app.services.email_service import send_notification_email

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
