"""Jobs that refresh cached TMDb data for titles people track."""
from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.services.collection_ingest_service import daily_refresh
from app.services.streaming_notification_service import (
    refresh_streaming_providers,
    send_user_streaming_alerts,
)
from app.services.trailer_notification_service import refresh_trailers, send_user_trailer_alerts
from app.services.vote_update_service import update_all_vote_averages


@logged_task(max_execution_seconds=1800)
def update_vote_averages() -> None:
    """
    Refresh vote_average for every tracked show and movie in one bulk job.
    The 30-minute ceiling is how long durable-queue keeps its lease alive;
    past the default 5 minutes the job could be recovered and run twice as
    the number of tracked titles grows.
    """
    db = SessionLocal()
    try:
        update_all_vote_averages(db)
    finally:
        db.close()


@logged_task(max_execution_seconds=3600)
def sync_collections() -> None:
    """
    Mirror TMDb's collections: today's id dump (yesterday's if today's isn't
    up yet), then the details of new and changed collections. Upserts, so a
    retry is harmless. Downloading and ingesting can take a while, hence the
    hour-long lease.
    """
    db = SessionLocal()
    try:
        daily_refresh(db)
    finally:
        db.close()


@logged_task(max_execution_seconds=1800)
def refresh_streaming() -> None:
    """
    Refresh US streaming providers for every tracked title and queue
    send_streaming_alerts for each opted-in user affected. The changes and
    the queued jobs commit together, so a retry finds nothing new.
    """
    db = SessionLocal()
    try:
        refresh_streaming_providers(db)
    finally:
        db.close()


@logged_task
def send_streaming_alerts(user_id: str, alerts: list[dict], key: str) -> None:
    """One user's streaming-change email and pushes. The email's Resend key
    is the same on every attempt, so a retry doesn't deliver it twice."""
    db = SessionLocal()
    try:
        send_user_streaming_alerts(db, user_id, alerts, key)
    finally:
        db.close()


@logged_task(max_execution_seconds=1800)
def refresh_trailer_videos() -> None:
    """
    Look for new official trailers and teasers on every tracked title and
    queue send_trailer_alerts for each opted-in user. New videos and the
    queued jobs commit together, so a retry finds nothing new.
    """
    db = SessionLocal()
    try:
        refresh_trailers(db)
    finally:
        db.close()


@logged_task
def send_trailer_alerts(user_id: str, alerts: list[dict], key: str) -> None:
    """One user's new-trailer email and pushes. The email's Resend key is the
    same on every attempt, so a retry doesn't deliver it twice."""
    db = SessionLocal()
    try:
        send_user_trailer_alerts(db, user_id, alerts, key)
    finally:
        db.close()
