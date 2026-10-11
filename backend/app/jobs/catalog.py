"""Jobs that refresh cached TMDb data for titles people track."""
from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.services.collection_ingest_service import daily_refresh
from app.services.streaming_notification_service import refresh_streaming_providers
from app.services.trailer_notification_service import refresh_trailers
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
    Refresh US streaming providers for every tracked title and alert opted-in
    users to changes. The changes commit before anyone is alerted, so a retry
    finds nothing new and alerts no one twice.
    """
    db = SessionLocal()
    try:
        refresh_streaming_providers(db)
    finally:
        db.close()


@logged_task(max_execution_seconds=1800)
def refresh_trailer_videos() -> None:
    """
    Look for new official trailers and teasers on every tracked title and
    alert opted-in users. New videos commit before anyone is alerted, so a
    retry finds nothing new and alerts no one twice.
    """
    db = SessionLocal()
    try:
        refresh_trailers(db)
    finally:
        db.close()
