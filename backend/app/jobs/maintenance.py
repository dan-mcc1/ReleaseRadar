"""Housekeeping jobs: deleting expired rows and lifting expired penalties."""
import logging

from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.services.activity_service import delete_old_activity, lift_expired_moderation
from app.services.recommendation_service import delete_old_recommendations

logger = logging.getLogger(__name__)


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
