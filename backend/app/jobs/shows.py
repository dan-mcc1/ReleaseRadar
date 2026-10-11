"""The nightly show refresh: a dispatcher fans out one job per show."""
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from durable_queue.sqlalchemy import enqueue_many

from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.models.show import Show
from app.services.episode_service import (
    active_show_ids,
    check_and_reactivate_watched_shows,
    refresh_show_data,
)

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")


@logged_task
def dispatch_show_refreshes() -> None:
    """
    Queue one refresh_show job per tracked, in-production show. The jobs are
    enqueued in this session and land with its commit, which also wakes the
    worker. Keyed by show and Eastern date, so running again on the same date
    (a retry, a late catch-up) queues nothing new.
    """
    db = SessionLocal()
    try:
        show_ids = active_show_ids(db)
        run_date = datetime.now(EASTERN).date().isoformat()
        enqueue_many(
            db,
            "refresh_show",
            [{"show_id": show_id} for show_id in show_ids],
            idempotency_keys=[f"refresh-show:{show_id}:{run_date}" for show_id in show_ids],
        )
        db.commit()
        logger.info("show refresh: queued %d show(s)", len(show_ids))
    finally:
        db.close()


@logged_task
def refresh_show(show_id: int) -> None:
    """
    Refresh one show from TMDb, then move it back to the Watchlist for anyone
    whose Watched entry now has a new episode. Safe to run again: a second run
    finds nothing left to reactivate, so no email goes out twice.
    """
    db = SessionLocal()
    try:
        show = db.get(Show, show_id)
        if show is None:
            logger.info("show refresh: show %s is no longer cached; skipped", show_id)
            return
        refresh_show_data(db, show)
        check_and_reactivate_watched_shows(db, show_id=show_id)
    finally:
        db.close()
