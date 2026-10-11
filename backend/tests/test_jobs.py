"""
Background jobs on durable-queue (app/jobs).

The queue's SQL is Postgres-only, so these call task functions directly and
patch the Runner; test_job_queue_postgres.py runs a job through a real queue.
"""

import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

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
