"""
Background jobs, run by durable-queue (github.com/dan-mcc1/durable-queue).

Every task module is imported here so its @logged_task functions are
registered before a worker looks one up by name.
"""
import logging

from durable_queue.db import get_connection
from durable_queue.runner import Runner
from durable_queue.scheduler import hourly, register_schedule
from psycopg.errors import UndefinedTable

from app.jobs import maintenance  # noqa: F401

logger = logging.getLogger(__name__)

# (schedule name, task name, args, when). Registered on every startup:
# re-registering updates a schedule's task, args and timing but leaves its
# next run alone, so a deploy neither skips nor repeats one. A run missed
# while the app was down happens once when it's back (no
# max_lateness_seconds).
SCHEDULES = [
    # On the hour, with the digest and episode-alert planning, so Neon
    # wakes once an hour for all three.
    ("activity-cleanup", "cleanup_activity", {}, hourly(0)),
]


def start_job_queue(dsn: str | None = None) -> Runner:
    """
    Register SCHEDULES, then start a worker and a scheduler on background
    threads in this process. dsn defaults to DURABLE_QUEUE_DATABASE_URL,
    then DATABASE_URL, which durable-queue reads from the environment.

    Raises if the database can't be reached or the queue's tables are
    missing, so the app fails at startup instead of running without jobs.
    """
    conn = get_connection(dsn)
    try:
        for name, task_name, args, when in SCHEDULES:
            register_schedule(conn, name, task_name, args, when)
    except UndefinedTable as exc:
        raise RuntimeError(
            "durable-queue's tables are missing; run `alembic upgrade head`"
        ) from exc
    finally:
        conn.close()

    # Jobs mostly wait on TMDb and Resend, so 4 threads keep up while
    # staying light on memory.
    runner = Runner(concurrency=4, dsn=dsn)
    runner.start()
    logger.info("job queue started with %d schedule(s)", len(SCHEDULES))
    return runner


def stop_job_queue(runner: Runner) -> None:
    """Stop the worker and scheduler, letting running jobs finish for up to
    the worker's 30 s shutdown_timeout. Blocks; call via asyncio.to_thread."""
    runner.stop()
