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
        from app.jobs import SCHEDULES, Schedule

        for schedule in SCHEDULES:
            assert isinstance(schedule, Schedule)
            get_registered_task(schedule.task)  # KeyError names a typo or unimported module
            json.dumps(schedule.args)  # stored as jsonb on every job

    def test_schedule_names_are_unique(self):
        from app.jobs import SCHEDULES

        # Registering a second entry under a taken name silently replaces it.
        names = [schedule.name for schedule in SCHEDULES]
        assert len(names) == len(set(names))

    def test_activity_cleanup_runs_at_the_top_of_every_hour(self):
        from durable_queue.scheduler import hourly
        from app.jobs import SCHEDULES, Schedule

        assert Schedule("activity-cleanup", "cleanup_activity", {}, hourly(0)) in SCHEDULES

    def test_nightly_jobs_run_at_3am_eastern(self):
        from durable_queue.scheduler import daily
        from app.jobs import SCHEDULES, Schedule

        at_3am = daily("03:00", "America/New_York")
        for name, task_name in [
            ("show-refresh", "dispatch_show_refreshes"),
            ("vote-update", "update_vote_averages"),
            ("cache-prune", "prune_cache"),
            ("job-purge", "purge_finished_jobs"),
        ]:
            assert Schedule(name, task_name, {}, at_3am) in SCHEDULES

    def test_daily_jobs_keep_their_times_and_late_pushes_are_skipped(self):
        from durable_queue.scheduler import daily
        from app.jobs import SCHEDULES, Schedule

        six_hours = 6 * 3600
        for schedule in [
            Schedule("stripe-reconcile", "reconcile_subscriptions", {},
                     daily("04:00", "America/New_York")),
            Schedule("collections-sync", "sync_collections", {}, daily("08:30", "UTC")),
            Schedule("streaming-refresh", "refresh_streaming", {},
                     daily("11:00", "America/New_York"), max_lateness_seconds=six_hours),
            Schedule("trailer-refresh", "refresh_trailer_videos", {},
                     daily("12:00", "America/New_York"), max_lateness_seconds=six_hours),
        ]:
            assert schedule in SCHEDULES

    def test_digests_are_dispatched_every_hour(self):
        from durable_queue.scheduler import hourly
        from app.jobs import SCHEDULES, Schedule

        assert Schedule("digests", "dispatch_digests", {}, hourly(0)) in SCHEDULES

    def test_premiere_alerts_are_dispatched_every_hour(self):
        from durable_queue.scheduler import hourly
        from app.jobs import SCHEDULES, Schedule

        assert Schedule("premiere-alerts", "dispatch_premiere_alerts", {}, hourly(0)) in SCHEDULES


class TestStartJobQueue:
    def test_registers_every_schedule_then_starts_the_runner(self):
        import app.jobs as jobs

        conn = MagicMock()
        events = []
        with patch.object(jobs, "get_connection", return_value=conn) as get_connection, \
             patch.object(jobs, "register_schedule") as register, \
             patch.object(jobs, "Runner") as Runner:
            register.side_effect = lambda *args, **kwargs: events.append("register")
            Runner.return_value.start.side_effect = lambda: events.append("start")
            runner = jobs.start_job_queue("postgresql://queue")

        get_connection.assert_called_once_with("postgresql://queue")
        assert register.call_args_list == [
            call(conn, s.name, s.task, s.args, s.when,
                 max_lateness_seconds=s.max_lateness_seconds)
            for s in jobs.SCHEDULES
        ]
        conn.close.assert_called_once()
        Runner.assert_called_once_with(concurrency=4, dsn="postgresql://queue")
        assert runner is Runner.return_value
        # Schedules exist before the scheduler thread first looks.
        assert events == ["register"] * len(jobs.SCHEDULES) + ["start"]

    def test_passes_each_schedules_lateness_to_register_schedule(self):
        from durable_queue.scheduler import hourly
        import app.jobs as jobs

        conn = MagicMock()
        schedules = [
            jobs.Schedule("skips-late", "cleanup_activity", {}, hourly(0), max_lateness_seconds=60),
            jobs.Schedule("catches-up", "cleanup_activity", {}, hourly(30)),
        ]
        with patch.object(jobs, "SCHEDULES", schedules),              patch.object(jobs, "get_connection", return_value=conn),              patch.object(jobs, "register_schedule") as register,              patch.object(jobs, "Runner"):
            jobs.start_job_queue()

        assert [c.kwargs["max_lateness_seconds"] for c in register.call_args_list] == [60, None]

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

    @staticmethod
    def _loops_started(monkeypatch):
        """Names of the loops lifespan starts with RUN_SCHEDULERS on."""
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
        return started

    def test_scheduler_loops_no_longer_run_the_activity_cleanup(self, monkeypatch):
        started = self._loops_started(monkeypatch)

        assert "_activity_cleanup_loop" not in started
        assert "_daily_digest_loop" in started  # the other loops still start

    def test_scheduler_loops_no_longer_run_the_3am_refresh(self, monkeypatch):
        started = self._loops_started(monkeypatch)

        assert "_episode_update_loop" not in started
        assert "_episode_alert_loop" in started

    def test_only_the_digest_and_episode_alert_loops_remain(self, monkeypatch):
        started = self._loops_started(monkeypatch)

        assert sorted(started) == ["_daily_digest_loop", "_episode_alert_loop"]


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


class TestUpdateVoteAverages:
    def test_updates_tracked_shows_vote_average(self, db, seed_users):
        from app.jobs.catalog import update_vote_averages
        from app.models.show import Show
        from app.models.watchlist import Watchlist

        db.add(Show(id=20, name="S", vote_average=5.0, tracking_count=0))
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=20))
        db.commit()

        with patch("app.services.vote_update_service.get", return_value={"vote_average": 7.5}):
            update_vote_averages()

        db.expire_all()
        assert db.get(Show, 20).vote_average == 7.5

    def test_registered_with_a_30_minute_ceiling(self):
        from durable_queue.registry import get_registered_task

        assert get_registered_task("update_vote_averages").max_execution_seconds == 1800


class TestPruneCache:
    def test_runs_the_prune_which_skips_while_disabled(self, db, caplog, monkeypatch):
        from app.config import settings
        from app.jobs.maintenance import prune_cache

        monkeypatch.setattr(settings, "CACHE_PRUNE_ENABLED", False)
        with caplog.at_level(logging.INFO):
            prune_cache()

        assert "cache prune: skipped" in caplog.text


class TestPurgeFinishedJobs:
    def test_deletes_week_old_jobs_until_a_short_batch(self):
        from app.jobs import maintenance

        conn = MagicMock()
        with patch.object(maintenance, "get_connection", return_value=conn), \
             patch.object(maintenance, "delete_completed_jobs",
                          side_effect=[1000, 1000, 3]) as delete:
            maintenance.purge_finished_jobs()

        assert delete.call_args_list == [call(conn, 7 * 24 * 3600.0, batch=1000)] * 3
        conn.close.assert_called_once()

    def test_closes_its_connection_when_the_delete_fails(self):
        import psycopg
        from app.jobs import maintenance

        conn = MagicMock()
        with patch.object(maintenance, "get_connection", return_value=conn), \
             patch.object(maintenance, "delete_completed_jobs",
                          side_effect=psycopg.OperationalError("gone")), \
             pytest.raises(psycopg.OperationalError):
            maintenance.purge_finished_jobs()

        conn.close.assert_called_once()


class TestDailyJobs:
    @pytest.mark.parametrize("module_name, job, service", [
        ("billing", "reconcile_subscriptions", "reconcile_stripe_subscriptions"),
        ("catalog", "sync_collections", "daily_refresh"),
    ])
    def test_runs_its_service_with_a_session(self, module_name, job, service):
        import importlib
        from sqlalchemy.orm import Session

        module = importlib.import_module(f"app.jobs.{module_name}")
        with patch.object(module, service) as run:
            getattr(module, job)()

        run.assert_called_once()
        assert isinstance(run.call_args.args[0], Session)

    @pytest.mark.parametrize("task, ceiling", [
        ("sync_collections", 3600),
        ("refresh_streaming", 1800),
        ("refresh_trailer_videos", 1800),
        ("reconcile_subscriptions", None),
    ])
    def test_lease_ceiling(self, task, ceiling):
        from durable_queue.registry import get_registered_task

        assert get_registered_task(task).max_execution_seconds == ceiling

    def test_streaming_rerun_after_its_commit_emails_no_one_twice(self, db):
        from app.jobs.catalog import refresh_streaming
        from app.models.movie import Movie
        from app.models.user import User
        from app.models.watchlist import Watchlist

        db.add(Movie(id=1, title="Fight Club", status="Released", tracking_count=0,
                     vote_average=0.0))
        db.add(User(id="u1", username="u1", email="u1@t.com", email_notifications=True,
                    notify_streaming_changes=True))
        db.flush()
        db.add(Watchlist(user_id="u1", content_id=1, content_type="movie", notify=True))
        db.commit()
        netflix = {
            "flatrate": [{"provider_id": 8, "provider_name": "Netflix", "logo_path": "/p8.png"}],
            "rent": [],
            "buy": [],
        }

        with patch("app.services.streaming_notification_service._fetch_fresh_us_providers",
                   return_value=netflix),              patch("app.services.streaming_notification_service.send_streaming_alert_email") as email:
            refresh_streaming()
            refresh_streaming()  # a retry after the first run committed

        assert email.call_count == 1

    def test_trailer_rerun_after_its_commit_emails_no_one_twice(self, db):
        from app.jobs.catalog import refresh_trailer_videos
        from app.models.movie import Movie
        from app.models.user import User
        from app.models.watchlist import Watchlist

        db.add(Movie(id=1, title="Fight Club", status="Released", tracking_count=0,
                     vote_average=0.0))
        db.add(User(id="u1", username="u1", email="u@t.com", subscription_tier="premium",
                    notify_trailers=True, email_notifications=True))
        db.flush()
        db.add(Watchlist(user_id="u1", content_id=1, content_type="movie", notify=True))
        db.commit()
        trailer = {"key": "vk1", "name": "Trailer 1", "type": "Trailer", "official": True}
        upcoming = {"release_date": "2999-01-01", "videos": {"results": [trailer]}}

        with patch("app.services.trailer_notification_service.fetch_movie_from_tmdb",
                   return_value=upcoming),              patch("app.services.trailer_notification_service.send_trailer_alert_email") as email:
            refresh_trailer_videos()
            refresh_trailer_videos()  # a retry after the first run committed

        assert email.call_count == 1


class _NineAmInNewYork(datetime):
    """June 1 2024, 13:00 UTC: 9am in New York."""

    @classmethod
    def now(cls, tz=None):
        return datetime(2024, 6, 1, 13, 0, tzinfo=timezone.utc).astimezone(tz)


def _digest_user(db, uid="u1", **overrides):
    from app.models.user import User

    fields = dict(id=uid, username=uid, email=f"{uid}@t.com", email_notifications=True,
                  notification_frequency="daily", digest_hour=9,
                  digest_timezone="America/New_York")
    fields.update(overrides)
    db.add(User(**fields))
    db.commit()


def _movie_out_today_on_watchlist(db, uid="u1"):
    from app.models.movie import Movie
    from app.models.watchlist import Watchlist

    db.add(Movie(id=1, title="Dune", status="Released", release_date=date.today(),
                 tracking_count=0, vote_average=0.0))
    db.add(Watchlist(user_id=uid, content_type="movie", content_id=1, notify=True))
    db.commit()


class TestDigestJobs:
    def test_dispatch_queues_users_due_now_keyed_by_day(self, db):
        from app.jobs import notifications

        _digest_user(db, "u1")                    # 9am: due
        _digest_user(db, "u2", digest_hour=20)    # 8pm: not yet
        calls = []
        with patch.object(notifications, "enqueue_many", _fake_enqueue_many(calls)),              patch.object(notifications, "datetime", _NineAmInNewYork):
            notifications.dispatch_digests()

        assert calls == [(
            "send_digest",
            [{"user_id": "u1", "digest_date": "2024-06-01"}],
            ["digest:u1:2024-06-01"],
        )]

    def test_sends_with_the_days_key_then_marks_the_user(self, db):
        from app.jobs import notifications
        from app.models.user import User

        _digest_user(db)
        _movie_out_today_on_watchlist(db)
        with patch.object(notifications, "send_notification_email") as email:
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")

        assert email.call_args.kwargs["idempotency_key"] == "digest:u1:2026-10-12"
        db.expire_all()
        assert db.get(User, "u1").last_digest_sent_at == date(2026, 10, 12)

    def test_skips_a_user_already_sent_that_day(self, db):
        from app.jobs import notifications

        _digest_user(db, last_digest_sent_at=date(2026, 10, 12))
        _movie_out_today_on_watchlist(db)
        with patch.object(notifications, "send_notification_email") as email:
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")

        email.assert_not_called()

    def test_nothing_to_send_leaves_the_user_unmarked(self, db):
        from app.jobs import notifications
        from app.models.user import User

        _digest_user(db)
        with patch.object(notifications, "send_notification_email") as email:
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")

        email.assert_not_called()
        db.expire_all()
        assert db.get(User, "u1").last_digest_sent_at is None

    def test_failed_send_raises_and_leaves_the_user_unmarked(self, db):
        from app.jobs import notifications
        from app.models.user import User

        _digest_user(db)
        _movie_out_today_on_watchlist(db)
        with patch.object(notifications, "send_notification_email",
                          side_effect=RuntimeError("resend down")),              pytest.raises(RuntimeError):
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")

        db.expire_all()
        assert db.get(User, "u1").last_digest_sent_at is None

    def test_running_twice_sends_once(self, db):
        from app.jobs import notifications

        _digest_user(db)
        _movie_out_today_on_watchlist(db)
        with patch.object(notifications, "send_notification_email") as email:
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")
            notifications.send_digest(user_id="u1", digest_date="2026-10-12")

        assert email.call_count == 1


def _premium_user(db, uid="u1", **overrides):
    _digest_user(db, uid, **{
        "subscription_tier": "premium", "notify_new_seasons": True,
        "push_notifications_enabled": True, "push_notify_new_seasons": True,
        **overrides,
    })


def _season_on_watchlist(db, uid="u1", *, alert_date=date(2026, 10, 12), days_out=20):
    from app.models.season import Season
    from app.models.show import Show
    from app.models.watchlist import Watchlist

    db.add(Show(id=10, name="The Rookie", tracking_count=0))
    db.flush()
    db.add(Season(id=1009, show_id=10, season_number=9,
                  air_date=alert_date + timedelta(days=days_out)))
    db.add(Watchlist(user_id=uid, content_type="tv", content_id=10, notify=True))
    db.commit()


class TestPremiereAlertJobs:
    def test_dispatch_queues_eligible_users_in_their_window(self, db):
        from app.jobs import notifications

        _premium_user(db, "u1")                                  # due
        _premium_user(db, "u2", subscription_tier="free")        # not premium
        _premium_user(db, "u3", digest_hour=20)                  # not yet
        calls = []
        with patch.object(notifications, "enqueue_many", _fake_enqueue_many(calls)),              patch.object(notifications, "datetime", _NineAmInNewYork):
            notifications.dispatch_premiere_alerts()

        assert calls == [(
            "send_premiere_alerts",
            [{"user_id": "u1", "alert_date": "2024-06-01"}],
            ["premiere:u1:2024-06-01"],
        )]

    def test_emails_records_then_pushes(self, db):
        from app.jobs import notifications
        from app.models.sent_premiere_alert import SentPremiereAlert

        _premium_user(db)
        _season_on_watchlist(db)
        with patch.object(notifications, "send_season_premiere_email") as email,              patch.object(notifications, "push_notification") as push:
            notifications.send_premiere_alerts(user_id="u1", alert_date="2026-10-12")

        assert email.call_args.kwargs["idempotency_key"] == "premiere:u1:2026-10-12"
        assert push.call_count == 1
        assert push.call_args.kwargs["title"] == "A new season of The Rookie airs in 20 days"
        db.expire_all()
        assert [(a.show_id, a.season_number, a.lead_days)
                for a in db.query(SentPremiereAlert)] == [(10, 9, 30)]

    def test_running_twice_sends_once(self, db):
        from app.jobs import notifications

        _premium_user(db)
        _season_on_watchlist(db)
        with patch.object(notifications, "send_season_premiere_email") as email,              patch.object(notifications, "push_notification") as push:
            notifications.send_premiere_alerts(user_id="u1", alert_date="2026-10-12")
            notifications.send_premiere_alerts(user_id="u1", alert_date="2026-10-12")

        assert (email.call_count, push.call_count) == (1, 1)

    def test_failed_email_records_nothing_and_pushes_nothing(self, db):
        from app.jobs import notifications
        from app.models.sent_premiere_alert import SentPremiereAlert

        _premium_user(db)
        _season_on_watchlist(db)
        with patch.object(notifications, "send_season_premiere_email",
                          side_effect=RuntimeError("resend down")),              patch.object(notifications, "push_notification") as push,              pytest.raises(RuntimeError):
            notifications.send_premiere_alerts(user_id="u1", alert_date="2026-10-12")

        push.assert_not_called()
        db.expire_all()
        assert db.query(SentPremiereAlert).count() == 0

    def test_push_only_user_gets_the_push_and_it_is_recorded(self, db):
        from app.jobs import notifications
        from app.models.sent_premiere_alert import SentPremiereAlert

        _premium_user(db, email_notifications=False)
        _season_on_watchlist(db)
        with patch.object(notifications, "send_season_premiere_email") as email,              patch.object(notifications, "push_notification") as push:
            notifications.send_premiere_alerts(user_id="u1", alert_date="2026-10-12")

        email.assert_not_called()
        assert push.call_count == 1
        db.expire_all()
        assert db.query(SentPremiereAlert).count() == 1
