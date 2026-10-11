"""
Background jobs on durable-queue (app/jobs).

The queue's SQL is Postgres-only, so these call task functions directly and
patch the Runner; test_job_queue_postgres.py runs a job through a real queue.
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, call, patch

import pytest


class TestCleanupActivity:
    def test_deletes_expired_activity_and_recommendations_keeps_newer(self, db):
        from app.jobs.maintenance import cleanup_activity
        from app.models.activity import Activity
        from app.models.recommendation import Recommendation
        from app.models.user import User

        now = datetime.now(timezone.utc)
        old, recent = now - timedelta(days=10), now - timedelta(days=2)
        db.add_all([
            User(id="u1", username="alice", email="alice@test.com"),
            User(id="u2", username="bob", email="bob@test.com"),
        ])
        db.flush()
        db.add_all([
            Activity(user_id="u1", activity_type="watched", content_type="movie",
                     content_id=1, created_at=old),
            Activity(user_id="u1", activity_type="watched", content_type="movie",
                     content_id=2, created_at=recent),
            Recommendation(sender_id="u1", recipient_id="u2", content_type="movie",
                           content_id=1, created_at=old),
            Recommendation(sender_id="u1", recipient_id="u2", content_type="movie",
                           content_id=2, created_at=recent),
        ])
        db.commit()

        cleanup_activity()

        db.expire_all()
        assert [a.content_id for a in db.query(Activity).all()] == [2]
        assert [r.content_id for r in db.query(Recommendation).all()] == [2]

    def test_lifts_expired_suspensions_and_silences_only(self, db):
        from app.jobs.maintenance import cleanup_activity
        from app.models.user import User

        now = datetime.now(timezone.utc)
        db.add_all([
            User(id="u1", username="alice", email="a@test.com", is_suspended=True,
                 suspended_until=now - timedelta(hours=1), suspension_reason="spam"),
            User(id="u2", username="bob", email="b@test.com", is_silenced=True,
                 silenced_until=now - timedelta(hours=1)),
            User(id="u3", username="carol", email="c@test.com", is_suspended=True,
                 suspended_until=now + timedelta(days=1)),
        ])
        db.commit()

        cleanup_activity()

        db.expire_all()
        users = {u.id: u for u in db.query(User).all()}
        assert users["u1"].is_suspended is False
        assert users["u1"].suspension_reason is None
        assert users["u2"].is_silenced is False
        assert users["u3"].is_suspended is True

    def test_failure_is_logged_with_traceback_and_reraised(self, caplog):
        from app.jobs import maintenance

        with patch.object(maintenance, "delete_old_activity",
                          side_effect=RuntimeError("db gone")), \
             caplog.at_level(logging.ERROR), \
             pytest.raises(RuntimeError, match="db gone"):
            maintenance.cleanup_activity()

        logged = [r for r in caplog.records if r.levelno >= logging.ERROR and r.exc_info]
        assert [str(r.exc_info[1]) for r in logged] == ["db gone"]
        assert "cleanup_activity" in logged[0].getMessage()

    def test_registered_with_durable_queue_under_its_name(self):
        from durable_queue.registry import get_registered_task
        from app.jobs.maintenance import cleanup_activity

        registered = get_registered_task("cleanup_activity")
        assert registered.fn is cleanup_activity
        assert registered.wants_connection is False


class TestSchedules:
    def test_every_schedule_names_a_registered_task_with_json_args(self):
        from durable_queue.registry import get_registered_task
        from app.jobs import SCHEDULES

        for name, task_name, args, when in SCHEDULES:
            get_registered_task(task_name)  # KeyError names a typo or unimported module
            json.dumps(args)  # stored as jsonb on every job

    def test_schedule_names_are_unique(self):
        from app.jobs import SCHEDULES

        # Registering a second entry under a taken name silently replaces it.
        names = [name for name, *_ in SCHEDULES]
        assert len(names) == len(set(names))

    def test_activity_cleanup_runs_at_the_top_of_every_hour(self):
        from durable_queue.scheduler import hourly
        from app.jobs import SCHEDULES

        assert ("activity-cleanup", "cleanup_activity", {}, hourly(0)) in SCHEDULES


class TestStartJobQueue:
    def test_registers_every_schedule_then_starts_the_runner(self):
        import app.jobs as jobs

        conn = MagicMock()
        events = []
        with patch.object(jobs, "get_connection", return_value=conn) as get_connection, \
             patch.object(jobs, "register_schedule") as register, \
             patch.object(jobs, "Runner") as Runner:
            register.side_effect = lambda *args: events.append("register")
            Runner.return_value.start.side_effect = lambda: events.append("start")
            runner = jobs.start_job_queue("postgresql://queue")

        get_connection.assert_called_once_with("postgresql://queue")
        assert register.call_args_list == [
            call(conn, name, task_name, args, when)
            for name, task_name, args, when in jobs.SCHEDULES
        ]
        conn.close.assert_called_once()
        Runner.assert_called_once_with(concurrency=4, dsn="postgresql://queue")
        assert runner is Runner.return_value
        # Schedules exist before the scheduler thread first looks.
        assert events == ["register"] * len(jobs.SCHEDULES) + ["start"]

    def test_missing_queue_tables_say_to_run_migrations(self):
        import app.jobs as jobs
        from psycopg.errors import UndefinedTable

        conn = MagicMock()
        with patch.object(jobs, "get_connection", return_value=conn), \
             patch.object(jobs, "register_schedule",
                          side_effect=UndefinedTable('relation "schedules" does not exist')), \
             patch.object(jobs, "Runner") as Runner, \
             pytest.raises(RuntimeError, match="alembic upgrade head"):
            jobs.start_job_queue()

        conn.close.assert_called_once()
        Runner.assert_not_called()

    def test_unreachable_database_raises_before_anything_starts(self):
        import psycopg
        import app.jobs as jobs

        with patch.object(jobs, "get_connection",
                          side_effect=psycopg.OperationalError("connection refused")), \
             patch.object(jobs, "Runner") as Runner, \
             pytest.raises(psycopg.OperationalError):
            jobs.start_job_queue()

        Runner.assert_not_called()

    def test_stop_stops_the_runner(self):
        import app.jobs as jobs

        runner = MagicMock()
        jobs.stop_job_queue(runner)
        runner.stop.assert_called_once_with()
