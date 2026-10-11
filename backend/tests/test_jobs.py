"""
Background jobs on durable-queue (app/jobs).

The queue's SQL is Postgres-only, so these call task functions directly and
patch the Runner; test_job_queue_postgres.py runs a job through a real queue.
"""

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
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


def _run_lifespan():
    """Enter and leave app.main's lifespan on a private event loop."""
    from app import main

    async def run():
        async with main.lifespan(main.app):
            pass

    # A private loop: asyncio.run() would unset the thread's current loop,
    # which other tests (e.g. test_tmdb_client) rely on.
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()


class TestLifespan:
    @pytest.fixture(autouse=True)
    def no_loops(self, monkeypatch):
        from app.config import settings

        monkeypatch.setattr(settings, "RUN_SCHEDULERS", False)

    def test_suite_runs_with_the_job_queue_off(self):
        from app.config import settings

        # conftest forces it off, so no test can reach a queue database
        # named in a local .env.
        assert settings.RUN_JOB_QUEUE is False

    def test_job_queue_off_starts_nothing(self, monkeypatch):
        from app import main
        from app.config import settings

        monkeypatch.setattr(settings, "RUN_JOB_QUEUE", False)
        with patch.object(main, "start_job_queue") as start, \
             patch.object(main, "stop_job_queue") as stop:
            _run_lifespan()

        start.assert_not_called()
        stop.assert_not_called()

    def test_job_queue_on_starts_then_stops_the_runner(self, monkeypatch):
        from app import main
        from app.config import settings

        monkeypatch.setattr(settings, "RUN_JOB_QUEUE", True)
        with patch.object(main, "start_job_queue") as start, \
             patch.object(main, "stop_job_queue") as stop:
            _run_lifespan()

        start.assert_called_once_with()
        stop.assert_called_once_with(start.return_value)

    def test_scheduler_loops_no_longer_run_the_activity_cleanup(self, monkeypatch):
        from app import main
        from app.config import settings

        monkeypatch.setattr(settings, "RUN_SCHEDULERS", True)
        monkeypatch.setattr(settings, "RUN_JOB_QUEUE", False)
        started = []

        def fake_create_task(coro):
            started.append(coro.__name__)
            coro.close()
            return asyncio.get_running_loop().create_future()

        with patch.object(main.asyncio, "create_task", fake_create_task):
            _run_lifespan()

        assert "_activity_cleanup_loop" not in started
        assert "_daily_digest_loop" in started  # the other loops still start


class _EveningInNewYork(datetime):
    """10:30pm Eastern on Oct 11, which is already Oct 12 in UTC."""

    @classmethod
    def now(cls, tz=None):
        assert tz is not None, "the dispatcher must ask for an aware time"
        return datetime(2026, 10, 12, 2, 30, tzinfo=timezone.utc).astimezone(tz)


def _fake_enqueue_many(calls):
    """Stands in for durable_queue.sqlalchemy.enqueue_many, whose SQL is
    Postgres-only. Records the call and writes a marker row through the same
    session, as the real one writes job rows, so a test can tell the
    dispatcher committed."""
    def enqueue_many(session, task, args_list, *, idempotency_keys=None):
        from app.models.genre import Genre

        calls.append((task, args_list, idempotency_keys))
        session.add(Genre(id=1, name="queued"))
        return list(range(len(args_list)))

    return enqueue_many


class TestDispatchShowRefreshes:
    def test_queues_one_refresh_per_show_keyed_by_eastern_date(self, db, seed_users):
        from app.jobs import shows
        from app.models.genre import Genre
        from app.models.show import Show
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        db.add_all([
            Show(id=10, name="A", in_production=True, tracking_count=0),
            Show(id=11, name="B", in_production=True, tracking_count=0),
            Show(id=12, name="Ended", in_production=False, tracking_count=0),
        ])
        db.add_all([
            Watchlist(user_id="test-uid-1", content_type="tv", content_id=10),
            Watched(user_id="test-uid-2", content_type="tv", content_id=11),
            Watched(user_id="test-uid-1", content_type="tv", content_id=12),
        ])
        db.commit()

        calls = []
        with patch.object(shows, "enqueue_many", _fake_enqueue_many(calls)), \
             patch.object(shows, "datetime", _EveningInNewYork):
            shows.dispatch_show_refreshes()

        assert calls == [(
            "refresh_show",
            [{"show_id": 10}, {"show_id": 11}],
            ["refresh-show:10:2026-10-11", "refresh-show:11:2026-10-11"],
        )]
        db.expire_all()
        assert db.get(Genre, 1) is not None  # committed

    def test_no_shows_queues_nothing(self, db, caplog):
        from app.jobs import shows

        calls = []
        with patch.object(shows, "enqueue_many", _fake_enqueue_many(calls)), \
             caplog.at_level(logging.INFO):
            shows.dispatch_show_refreshes()

        assert [args for _, args, _ in calls] == [[]]
        assert "queued 0 show(s)" in caplog.text


def _seed_watched_show(db, show_id, *, episode_name, air_date):
    """A show in production with one season-1 episode, on test-uid-1's
    Watched list with nothing marked watched."""
    from app.models.episode import Episode
    from app.models.season import Season
    from app.models.show import Show
    from app.models.watched import Watched

    db.add(Show(id=show_id, name=f"Show {show_id}", number_of_seasons=1,
                in_production=True, tracking_count=0))
    db.flush()
    db.add(Season(id=show_id * 10, show_id=show_id, season_number=1, episode_count=1))
    db.add(Episode(id=show_id * 100 + 1, show_id=show_id, season_number=1,
                   episode_number=1, name=episode_name, air_date=air_date))
    db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=show_id))


def _tmdb_for_show_800(path, params=None):
    """TMDb for show 800: one season whose pilot now has a name and has aired."""
    if path == "/tv/800":
        return {"number_of_seasons": 1, "in_production": True,
                "seasons": [{"season_number": 1, "id": 8000}]}
    if path == "/tv/800/season/1":
        return {"episodes": [{"id": 80001, "episode_number": 1, "name": "Pilot",
                              "air_date": date(2024, 3, 1)}]}
    raise AssertionError(f"unexpected TMDb call {path}")


class TestRefreshShow:
    @pytest.fixture
    def two_watched_shows(self, db, seed_users):
        from app.models.user import User

        db.get(User, "test-uid-1").email_notifications = True
        # 800's pilot has no name or air date yet; the refresh fills them in.
        _seed_watched_show(db, 800, episode_name=None, air_date=None)
        # 801 already has an aired episode test-uid-1 hasn't watched.
        _seed_watched_show(db, 801, episode_name="Pilot",
                           air_date=date.today() - timedelta(days=1))
        db.commit()

    def test_refreshes_episodes_and_reactivates_only_that_show(self, db, two_watched_shows):
        from app.jobs.shows import refresh_show
        from app.models.episode import Episode
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        with patch("app.services.episode_service.get", side_effect=_tmdb_for_show_800), \
             patch("app.services.episode_service.send_new_season_available_email") as email:
            refresh_show(show_id=800)

        db.expire_all()
        assert db.get(Episode, 80001).name == "Pilot"
        assert db.query(Watchlist).filter_by(content_id=800).first() is not None
        assert db.query(Watched).filter_by(content_id=800).first() is None
        assert db.query(Watched).filter_by(content_id=801).first() is not None
        assert email.call_count == 1

    def test_running_again_sends_no_second_email(self, db, two_watched_shows):
        from app.jobs.shows import refresh_show

        with patch("app.services.episode_service.get", side_effect=_tmdb_for_show_800), \
             patch("app.services.episode_service.send_new_season_available_email") as email:
            refresh_show(show_id=800)
            refresh_show(show_id=800)  # a retry after the first run committed

        assert email.call_count == 1

    def test_missing_show_is_skipped(self, db, caplog):
        from app.jobs.shows import refresh_show

        with patch("app.services.episode_service.get") as tmdb, caplog.at_level(logging.INFO):
            refresh_show(show_id=424242)

        tmdb.assert_not_called()
        assert "no longer cached" in caplog.text

    def test_database_error_propagates_for_retry(self, db):
        from sqlalchemy.exc import OperationalError
        from app.jobs import shows
        from app.models.show import Show

        db.add(Show(id=802, name="X", in_production=True, tracking_count=0))
        db.commit()
        dropped = OperationalError("SELECT 1", {}, Exception("connection dropped"))

        with patch.object(shows, "refresh_show_data", side_effect=dropped), \
             pytest.raises(OperationalError):
            shows.refresh_show(show_id=802)

    def test_registered_under_the_name_the_dispatcher_enqueues(self):
        from durable_queue.registry import get_registered_task
        from app.jobs.shows import refresh_show

        assert get_registered_task("refresh_show").fn is refresh_show
