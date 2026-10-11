"""Housekeeping jobs: deleting expired rows and lifting expired penalties."""
import logging
from datetime import timedelta

from durable_queue.db import get_connection
from durable_queue.jobs import delete_completed_jobs

from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.services.activity_service import delete_old_activity, lift_expired_moderation
from app.services.cache_prune_service import prune_stale_cache
from app.services.recommendation_service import delete_old_recommendations

logger = logging.getLogger(__name__)

# How long finished jobs stay visible in `durable-queue ls` and `dead`. Their
# idempotency keys go with them, which is safe: the longest window any key
# needs is a day (refresh-show:<id>:<date>).
JOB_RETENTION = timedelta(days=7)
# delete_completed_jobs deletes at most this many rows per call.
PURGE_BATCH = 1000


@logged_task
def cleanup_activity() -> None:
    """
    Delete activity and recommendations past their cutoffs, and lift
    suspensions and silences that have ended. Each step commits on its own
    and only touches rows past a cutoff, so a retry after a partial run
    just finishes the job.
    """
    db = SessionLocal()
    try:
        deleted_activity = delete_old_activity(db)
        if deleted_activity:
            logger.info(
                "activity cleanup: removed %d old activity entries", deleted_activity
            )
        deleted_recs = delete_old_recommendations(db)
        if deleted_recs:
            logger.info(
                "activity cleanup: removed %d expired recommendations", deleted_recs
            )
        lift_expired_moderation(db)
    finally:
        db.close()


@logged_task
def prune_cache() -> None:
    """Delete stale cached titles nobody references. A no-op unless
    CACHE_PRUNE_ENABLED is on."""
    db = SessionLocal()
    try:
        prune_stale_cache(db)
    finally:
        db.close()


@logged_task
def purge_finished_jobs() -> None:
    """Delete succeeded and dead jobs that finished more than JOB_RETENTION
    ago, a batch at a time until a batch comes back short."""
    conn = get_connection()
    try:
        total = 0
        while True:
            deleted = delete_completed_jobs(
                conn, JOB_RETENTION.total_seconds(), batch=PURGE_BATCH
            )
            total += deleted
            if deleted < PURGE_BATCH:
                break
    finally:
        conn.close()
    if total:
        logger.info("job purge: deleted %d finished job(s)", total)
