"""Jobs that refresh cached TMDb data for titles people track."""
from app.db.session import SessionLocal
from app.jobs.base import logged_task
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
