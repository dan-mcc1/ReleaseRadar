"""
The job queue end to end on a real Postgres: a schedule comes due, the
scheduler enqueues its job, and the worker runs it and marks it succeeded.

Skipped unless DURABLE_QUEUE_TEST_URL is set. Every table in that database
is dropped, so point it at a throwaway container, never at Neon:

    docker run -d --name rr-queue-test-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16
    $env:DURABLE_QUEUE_TEST_URL = "postgresql://postgres:pg@localhost:55432/postgres"
    python -m pytest tests/test_job_queue_postgres.py -v
"""

import importlib.util
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

TEST_URL = os.environ.get("DURABLE_QUEUE_TEST_URL")
pytestmark = pytest.mark.skipif(
    not TEST_URL, reason="set DURABLE_QUEUE_TEST_URL to a throwaway Postgres"
)

QUEUE_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic" / "versions" / "7d1e4c2b9a50_add_durable_queue_tables.py"
)


@pytest.fixture
def pg_sessions(monkeypatch):
    """A fresh database at TEST_URL: the app's tables from the models, the
    queue's from their real migration. Yields a session factory for it."""
    import psycopg
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401 — registers all models with Base.metadata
    import app.jobs.catalog as catalog
    import app.jobs.maintenance as maintenance
    import app.jobs.shows as shows
    from app.db.base import Base

    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")

    engine = create_engine(TEST_URL)
    Base.metadata.create_all(engine)
    spec = importlib.util.spec_from_file_location("queue_migration", QUEUE_MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration.upgrade()

    # Any connection durable-queue opens without an explicit dsn lands here
    # too, never on a database named in a local .env.
    monkeypatch.setenv("DURABLE_QUEUE_DATABASE_URL", TEST_URL)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    for jobs_module in (catalog, maintenance, shows):
        monkeypatch.setattr(jobs_module, "SessionLocal", sessions)
    yield sessions
    engine.dispose()


def test_scheduled_cleanup_runs_through_the_queue(pg_sessions):
    import psycopg
    from durable_queue import wakeup
    from app.jobs import start_job_queue, stop_job_queue
    from app.models.activity import Activity
    from app.models.user import User

    with pg_sessions() as db:
        db.add(User(id="u1", username="alice", email="alice@test.com"))
        db.flush()
        db.add(Activity(
            user_id="u1", activity_type="watched", content_type="movie", content_id=1,
            created_at=datetime.now(timezone.utc) - timedelta(days=10),
        ))
        db.commit()

    row = None
    runner = start_job_queue(TEST_URL)
    try:
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            # Registered for the next top of the hour. Pull it into the past,
            # then wake the idle scheduler, which only hears this process.
            conn.execute(
                "UPDATE schedules SET next_run_at = now() - interval '1 minute'"
                " WHERE name = 'activity-cleanup'"
            )
            wakeup.wake()
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                row = conn.execute(
                    "SELECT status, attempts, last_error FROM jobs"
                    " WHERE task = 'cleanup_activity'"
                ).fetchone()
                if row and row[0] in ("succeeded", "dead"):
                    break
                time.sleep(0.2)
    finally:
        stop_job_queue(runner)

    assert row is not None and row[0] == "succeeded", row
    with pg_sessions() as db:
        assert db.query(Activity).count() == 0


def test_show_refresh_fans_out_once_per_show(pg_sessions, monkeypatch):
    import psycopg
    from durable_queue import wakeup
    from app.jobs import start_job_queue, stop_job_queue
    from app.jobs.shows import dispatch_show_refreshes
    from app.models.show import Show
    from app.models.user import User
    from app.models.watchlist import Watchlist

    with pg_sessions() as db:
        db.add(User(id="u1", username="alice", email="alice@test.com"))
        db.add_all([
            Show(id=10, name="A", in_production=True, tracking_count=0),
            Show(id=11, name="B", in_production=True, tracking_count=0),
        ])
        db.flush()
        db.add_all([
            Watchlist(user_id="u1", content_type="tv", content_id=10),
            Watchlist(user_id="u1", content_type="tv", content_id=11),
        ])
        db.commit()
    # An empty TMDb answer makes each refresh a quick no-op.
    monkeypatch.setattr("app.services.episode_service.get", lambda path, params=None: {})

    def refresh_jobs(conn):
        return conn.execute(
            "SELECT status FROM jobs WHERE task = 'refresh_show'"
        ).fetchall()

    rows = []
    runner = start_job_queue(TEST_URL)
    try:
        with psycopg.connect(TEST_URL, autocommit=True) as conn:
            conn.execute(
                "UPDATE schedules SET next_run_at = now() - interval '1 minute'"
                " WHERE name = 'show-refresh'"
            )
            wakeup.wake()
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                rows = refresh_jobs(conn)
                if len(rows) == 2 and all(r[0] in ("succeeded", "dead") for r in rows):
                    break
                time.sleep(0.2)

            # A second dispatch the same day (a retry, a late catch-up).
            dispatch_show_refreshes()
            again = refresh_jobs(conn)
    finally:
        stop_job_queue(runner)

    assert [r[0] for r in rows] == ["succeeded", "succeeded"], rows
    assert len(again) == 2
