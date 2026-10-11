# Job Queue Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the hourly activity cleanup on durable-queue inside the API process, with the plumbing (task decorator, schedules, Runner start/stop, logging, setting) that every later job move reuses.

**Architecture:** A new `app/jobs/` package holds task modules (`@logged_task` functions), a `SCHEDULES` list, and `start_job_queue()` / `stop_job_queue()`. FastAPI's lifespan starts a `durable_queue.runner.Runner` (worker + scheduler threads in idle mode) when `RUN_JOB_QUEUE` is on, and the old `_activity_cleanup_loop` is deleted so the cleanup never runs twice.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 + psycopg2 (app), durable-queue @ `5be31a9` + psycopg 3.3.6 (queue), pytest on in-memory SQLite, Postgres 16 in Docker for the optional integration test.

**Spec:** `docs/superpowers/specs/2026-10-11-job-queue-foundation-design.md`

## Global Constraints

- Run every command from `backend/` with `backend\venv` activated (`venv\Scripts\Activate.ps1`); that venv has durable-queue installed.
- durable-queue stays pinned to commit `5be31a99ad413435943b072bc6eb822c0eadd721`, psycopg to `3.3.6`. psycopg2 stays SQLAlchemy's driver; do not move the app to psycopg 3.
- Worker concurrency is `4`: `Runner(concurrency=4)`.
- New setting `RUN_JOB_QUEUE: bool = True`. `RUN_SCHEDULERS` is unchanged and still gates the other seven loops.
- The one schedule is exactly `("activity-cleanup", "cleanup_activity", {}, hourly(0))`, with no `max_lateness_seconds`.
- Tasks open their own `SessionLocal()`. No transactional (`conn`-parameter) tasks.
- Task names come from function names and durable-queue's registry is global, so names must be unique across the app.
- The queue connects with `DURABLE_QUEUE_DATABASE_URL` (direct Neon endpoint), falling back to `DATABASE_URL`.
- The test suite stays on in-memory SQLite. Unit tests never touch the queue tables and never start a Runner.
- Only the activity cleanup moves. The other seven loops in `app/main.py` are not touched.
- Commit messages are plain sentences (match `git log`), ending with the `Co-Authored-By` line.

## Review Focus

1. **A test enters the app's lifespan while `backend/.env` names a real queue database.** `load_dotenv()` in `app/db/session.py` exports `.env` into `os.environ`, so once `DURABLE_QUEUE_DATABASE_URL` is in `.env`, a lifespan-entering test would register schedules and run jobs on the Neon dev branch. Expected: the suite never reaches a real database. Pinned in Task 4 (conftest forces `RUN_JOB_QUEUE=false`, plus a test) and Task 5 (integration test pins the env var to its own URL).
2. **A job raises.** durable-queue writes only `str(exc)` to `jobs.last_error` and logs nothing, so as specced a failing cleanup would never reach the logs or Sentry, a regression from today's `logger.exception("activity cleanup error")`. Expected: a traceback in the logs on every failed attempt, and the exception still raised so durable-queue retries. Pinned in Task 2 (`logged_task`).
3. **The app starts against a database where `alembic upgrade head` hasn't run.** That's likely the Neon dev branch's state on first local run. Expected: startup fails with a message that says to run migrations, not a bare `relation "schedules" does not exist`. Pinned in Task 3.
4. **After the move the cleanup runs twice (old loop plus queue), or not at all.** Expected: with `RUN_SCHEDULERS` on, the loops started no longer include the activity cleanup, and the other loops still start. Pinned in Task 4.
5. **A `SCHEDULES` entry with a duplicate name, a typo'd task name, or non-JSON args.** Duplicates silently overwrite each other on registration, and bad args fail only at startup in production. Expected: caught by the unit suite. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/jobs/__init__.py` (create) | Imports task modules (registration), `SCHEDULES`, `start_job_queue()`, `stop_job_queue()` |
| `backend/app/jobs/base.py` (create) | `logged_task`: durable-queue's `@task` plus a logged traceback on failure |
| `backend/app/jobs/maintenance.py` (create) | `cleanup_activity` task |
| `backend/app/core/logging.py` (modify) | `setup_logging()` also configures the `durable_queue` logger |
| `backend/app/config/__init__.py` (modify) | `RUN_JOB_QUEUE` setting |
| `backend/app/main.py` (modify) | Lifespan starts/stops the queue; `_activity_cleanup_loop` and `_seconds_until_next_hour` removed |
| `backend/tests/test_jobs.py` (create) | Task, schedule, start/stop and lifespan tests |
| `backend/tests/test_error_logging.py` (modify) | durable_queue logger tests; scheduler-loop test moves to `_episode_alert_loop` |
| `backend/tests/conftest.py` (modify) | Forces `RUN_JOB_QUEUE=false` |
| `backend/tests/test_job_queue_postgres.py` (create) | Optional end-to-end test on real Postgres |
| `CLAUDE.md` (modify) | Documents `app/jobs/`, `RUN_JOB_QUEUE`, the CLI, and the integration test |

---

### Task 1: Branch, commit the groundwork, and format durable_queue's logs

**Files:**
- Modify: `backend/app/core/logging.py:38-50`
- Test: `backend/tests/test_error_logging.py` (class `TestAppLoggerSetup`)

**Interfaces:**
- Consumes: nothing.
- Produces: `setup_logging()` gives the `durable_queue` logger one formatted `StreamHandler` at INFO, the same as `app`.

- [ ] **Step 1: Branch and commit the groundwork already in the working tree**

The migration, `alembic/env.py` exclusion, `requirements.txt` pins and the spec are uncommitted on `main`. Commit them as the branch's first commit so a worktree or reviewer sees them.

```powershell
git switch -c durable-queue-foundation
git add backend/alembic/env.py backend/requirements.txt backend/alembic/versions/7d1e4c2b9a50_add_durable_queue_tables.py docs/superpowers/
git commit -m @'
Added durable-queue's tables (migration 7d1e4c2b9a50), excluded them from autogenerate, and pinned durable-queue and psycopg 3. Spec and plan for moving background jobs onto it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 2: Run the suite for a baseline**

Run: `python -m pytest tests/ -q`
Expected: `1647 passed, 25 skipped` (measured 2026-10-11). Later tasks compare against this.

- [ ] **Step 3: Write the failing tests**

In `backend/tests/test_error_logging.py`, add this method to `TestAppLoggerSetup`, and replace `test_setup_is_idempotent` with the version below:

```python
    def test_durable_queue_info_lines_are_emitted_formatted(self, capsys):
        from app.core.logging import setup_logging

        queue_logger = logging.getLogger("durable_queue")
        saved = queue_logger.handlers[:]
        try:
            setup_logging()
            logging.getLogger("durable_queue.runner").info("worker restarted")
            err = capsys.readouterr().err
        finally:
            queue_logger.handlers[:] = saved

        # Formatted, not bare: logging's last-resort handler would print only
        # the message, and only at WARNING and above.
        assert "INFO durable_queue.runner: worker restarted" in err

    def test_setup_is_idempotent(self):
        from app.core.logging import setup_logging

        loggers = [logging.getLogger("app"), logging.getLogger("durable_queue")]
        saved = [named.handlers[:] for named in loggers]
        try:
            setup_logging()
            setup_logging()
            counts = [len(named.handlers) for named in loggers]
        finally:
            for named, handlers in zip(loggers, saved):
                named.handlers[:] = handlers

        assert counts == [1, 1]
```

- [ ] **Step 4: Run them to verify they fail**

Run: `python -m pytest tests/test_error_logging.py::TestAppLoggerSetup -v`
Expected: both new/changed tests FAIL (`worker restarted` not in stderr; `counts == [1, 0]`). `test_app_info_lines_are_emitted` still passes.

- [ ] **Step 5: Implement**

In `backend/app/core/logging.py`, replace everything in `setup_logging()` from the `# The app's own loggers` comment to the end of the function with:

```python
    # The app's own loggers (logging.getLogger(__name__) under app.*), and
    # durable_queue's (the job queue's reconnects, slot errors and loop
    # crashes). uvicorn only configures its own, so without this INFO lines
    # were dropped and warnings/errors went out bare through logging's
    # last-resort handler. Still propagates, so pytest's caplog and any root
    # handlers see them; Sentry hooks every logger and records ERROR and
    # above as events.
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    for name in ("app", "durable_queue"):
        named_handler = logging.StreamHandler()
        named_handler.setFormatter(formatter)
        named_logger = logging.getLogger(name)
        named_logger.handlers.clear()
        named_logger.addHandler(named_handler)
        named_logger.setLevel(logging.INFO)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/test_error_logging.py -v`
Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/core/logging.py backend/tests/test_error_logging.py
git commit -m @'
durable-queue's log lines now come out formatted at INFO, like the app's own.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 2: `logged_task` and the `cleanup_activity` task

**Files:**
- Create: `backend/app/jobs/__init__.py`
- Create: `backend/app/jobs/base.py`
- Create: `backend/app/jobs/maintenance.py`
- Test: `backend/tests/test_jobs.py`

**Interfaces:**
- Consumes: `delete_old_activity(db) -> int`, `lift_expired_moderation(db) -> None` (`app.services.activity_service`); `delete_old_recommendations(db) -> int` (`app.services.recommendation_service`); `SessionLocal` (`app.db.session`). Each service commits itself.
- Produces:
  - `app.jobs.base.logged_task(fn=None, **options)`: decorator usable as `@logged_task` or `@logged_task(max_attempts=3)`; options go straight to `durable_queue.registry.task`. Registers under `fn.__name__`. The wrapped function takes keyword arguments only (durable-queue calls `fn(**job["args"])`).
  - `app.jobs.maintenance.cleanup_activity() -> None`, registered with durable-queue as `"cleanup_activity"`.

Why `logged_task` and not plain `@task`: durable-queue's `run_job` catches a task's exception and passes only `str(exc)` to `mark_failed`. It logs nothing, so a failing job would never reach the logs or Sentry. `functools.wraps` sets `__wrapped__`, which `inspect.signature` follows, so durable-queue's `conn`-parameter detection still sees the real signature.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_jobs.py`:

```python
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.jobs'`.

- [ ] **Step 3: Implement**

Create `backend/app/jobs/base.py`:

```python
"""The decorator every ReleaseRadar job uses in place of durable-queue's @task."""
import functools
import logging
from collections.abc import Callable
from typing import Any

from durable_queue.registry import task

logger = logging.getLogger(__name__)


def logged_task(fn: Callable[..., Any] | None = None, **options: Any) -> Any:
    """
    durable-queue's @task (same options), plus a traceback in the logs when
    the job raises. durable-queue only writes the exception's message to the
    job row, so without this a failing job never reaches the logs or Sentry.
    Every failed attempt logs, not just the last.

    The exception is re-raised so durable-queue still retries the job. The
    task is registered under the function's name, which must be unique
    app-wide.
    """
    def register(fn: Callable[..., Any]) -> Callable[..., Any]:
        # wraps() keeps the name durable-queue registers under, and sets
        # __wrapped__, which inspect.signature follows when durable-queue
        # checks for a `conn` parameter.
        @functools.wraps(fn)
        def run(**kwargs: Any) -> Any:
            try:
                return fn(**kwargs)
            except Exception:
                logger.exception("job %s failed", fn.__name__)
                raise

        return task(run, **options)

    if fn is None:
        return register
    return register(fn)
```

Create `backend/app/jobs/maintenance.py`:

```python
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
```

Create `backend/app/jobs/__init__.py`:

```python
"""
Background jobs, run by durable-queue (github.com/dan-mcc1/durable-queue).

Every task module is imported here so its @logged_task functions are
registered before a worker looks one up by name.
"""
from app.jobs import maintenance  # noqa: F401
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/jobs backend/tests/test_jobs.py
git commit -m @'
Added app/jobs with the hourly activity cleanup as a durable-queue task. logged_task logs a failing job's traceback, which durable-queue itself doesn't.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 3: `SCHEDULES`, `start_job_queue`, `stop_job_queue`

**Files:**
- Modify: `backend/app/jobs/__init__.py` (whole file)
- Test: `backend/tests/test_jobs.py` (add classes)

**Interfaces:**
- Consumes: `cleanup_activity` registered as `"cleanup_activity"` (Task 2); from durable-queue: `durable_queue.db.get_connection(dsn: str | None = None) -> psycopg.Connection`, `durable_queue.scheduler.register_schedule(conn, name, task, args, when)` (commits; safe to repeat), `durable_queue.scheduler.hourly(minute=0) -> Clock`, `durable_queue.runner.Runner(*, concurrency, dsn=None)` with `.start()` (opens one connection up front, raises if unreachable) and `.stop()` (blocks up to the worker's 30 s `shutdown_timeout`).
- Produces:
  - `app.jobs.SCHEDULES: list[tuple[str, str, dict, Clock | int]]`, entries `(schedule name, task name, args, when)`.
  - `app.jobs.start_job_queue(dsn: str | None = None) -> Runner`. `dsn=None` means durable-queue's default: `DURABLE_QUEUE_DATABASE_URL`, then `DATABASE_URL`. The parameter exists for the integration test (Task 5).
  - `app.jobs.stop_job_queue(runner: Runner) -> None`. Blocking.

- [ ] **Step 1: Write the failing tests**

At the top of `backend/tests/test_jobs.py`, add `import json` and change `from unittest.mock import patch` to:

```python
from unittest.mock import MagicMock, call, patch
```

Append to `backend/tests/test_jobs.py`:

```python
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: the 7 new tests FAIL with `ImportError: cannot import name 'SCHEDULES'` / `AttributeError: ... has no attribute 'get_connection'`. Task 2's 4 tests still pass.

- [ ] **Step 3: Implement**

Replace `backend/app/jobs/__init__.py` with:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_jobs.py -v`
Expected: 11 PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/app/jobs/__init__.py backend/tests/test_jobs.py
git commit -m @'
Added the job queue's schedules and start/stop. Startup fails with a pointer to alembic if the queue's tables are missing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 4: Lifespan runs the queue; the old cleanup loop goes

**Files:**
- Modify: `backend/app/config/__init__.py:72-76` (add setting after `RUN_SCHEDULERS`)
- Modify: `backend/app/main.py:77-78` (imports), `:104-107` (`_seconds_until_next_hour`), `:122-144` (`_activity_cleanup_loop`), `:314-341` (`lifespan`)
- Modify: `backend/tests/conftest.py:25-29`
- Modify: `backend/tests/test_error_logging.py:78-94`
- Modify: `CLAUDE.md` (Backend architecture, Environment Variables)
- Test: `backend/tests/test_jobs.py` (add class)

**Interfaces:**
- Consumes: `start_job_queue() -> Runner` and `stop_job_queue(runner)` from `app.jobs` (Task 3).
- Produces: `settings.RUN_JOB_QUEUE: bool` (default `True`). `app.main` imports `start_job_queue` / `stop_job_queue` by name, so tests patch `app.main.start_job_queue` / `app.main.stop_job_queue`.

- [ ] **Step 1: Move the scheduler-loop logging test off the loop being deleted**

In `backend/tests/test_error_logging.py`, replace `test_scheduler_loop_failure_logs_traceback` with:

```python
    def test_scheduler_loop_failure_logs_traceback(self, caplog):
        from app import main

        with patch.object(main, "plan_episode_alerts", side_effect=RuntimeError("db gone")), \
             patch.object(main.asyncio, "sleep", side_effect=asyncio.CancelledError), \
             caplog.at_level(logging.ERROR):
            # A private loop: asyncio.run() would clear the main thread's
            # current event loop, which other tests rely on.
            loop = asyncio.new_event_loop()
            try:
                with pytest.raises(asyncio.CancelledError):
                    loop.run_until_complete(main._episode_alert_loop())
            finally:
                loop.close()

        logged = _errors_with_traceback(caplog)
        assert [str(r.exc_info[1]) for r in logged] == ["db gone"]
```

Run: `python -m pytest tests/test_error_logging.py -v`
Expected: PASS on the current code (`_episode_alert_loop` plans before its first sleep, logs the error, then hits the patched `sleep(60)`).

- [ ] **Step 2: Write the failing tests**

Add `import asyncio` to the imports at the top of `backend/tests/test_jobs.py`, then append:

```python
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `python -m pytest tests/test_jobs.py::TestLifespan -v`
Expected: all 4 FAIL with an `AttributeError` naming `RUN_JOB_QUEUE`, since the setting doesn't exist yet. (After Step 4 adds it, the three lifespan tests would still fail, on the missing `app.main.start_job_queue` and on `'_activity_cleanup_loop' in started`, until Step 5.)

- [ ] **Step 4: Add the setting and force it off in tests**

In `backend/app/config/__init__.py`, after `RUN_SCHEDULERS: bool = True`, add:

```python

    # Whether this process runs durable-queue's worker and scheduler (app/jobs).
    # Safe on every replica, since jobs and schedules are claimed under row
    # locks. Set false to stop background jobs here, locally or as a back-out.
    RUN_JOB_QUEUE: bool = True
```

In `backend/tests/conftest.py`, after the `os.environ["SENTRY_DSN"] = ""` line, add:

```python
# The job queue needs Postgres. Forced off (not setdefault) so a test that
# enters the app's lifespan can't reach a queue database named in a local .env.
os.environ["RUN_JOB_QUEUE"] = "false"
```

- [ ] **Step 5: Start the queue from the lifespan and delete the old loop**

In `backend/app/main.py`:

1. Delete these two imports (lines 77-78):

```python
from app.services.activity_service import delete_old_activity, lift_expired_moderation
from app.services.recommendation_service import delete_old_recommendations
```

and add, after the `from app.db.session import SessionLocal, engine` line:

```python
from app.jobs import start_job_queue, stop_job_queue
```

2. Delete `_seconds_until_next_hour()` (lines 104-107); only the cleanup loop used it.

3. Delete `_activity_cleanup_loop()` (lines 122-144) entirely.

4. Replace the body of `lifespan` from `tasks: list[asyncio.Task] = []` to the end with:

```python
    runner = None
    if settings.RUN_JOB_QUEUE:
        # A connect and a few statements, before any request is served.
        # Raises if the queue's database is unreachable, failing startup.
        runner = start_job_queue()
    else:
        logger.info("RUN_JOB_QUEUE=false — job queue disabled on this replica")

    tasks: list[asyncio.Task] = []
    if settings.RUN_SCHEDULERS:
        tasks = [
            asyncio.create_task(_daily_digest_loop()),
            asyncio.create_task(_episode_update_loop()),
            asyncio.create_task(_streaming_refresh_loop()),
            asyncio.create_task(_trailer_refresh_loop()),
            asyncio.create_task(_stripe_reconciliation_loop()),
            asyncio.create_task(_episode_alert_loop()),
            asyncio.create_task(_collection_sync_loop()),
        ]
    else:
        logger.info("RUN_SCHEDULERS=false — background loops disabled on this replica")
    yield
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    if runner is not None:
        await asyncio.to_thread(stop_job_queue, runner)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/test_jobs.py tests/test_error_logging.py tests/test_episode_alert_loop.py -v`
Expected: all PASS.

- [ ] **Step 7: Update CLAUDE.md**

In `CLAUDE.md`, replace the `main.py` bullet and its three sub-bullets under "Backend (`backend/app/`)" with:

```markdown
- **`main.py`** — FastAPI app entry point. Registers all routers, starts the durable-queue job runner (`jobs/`) when `RUN_JOB_QUEUE` is on, and starts the background async loops not yet moved to it (daily digest, 3am episode refresh, streaming/trailer refresh, Stripe reconcile, episode alerts, collections sync) when `RUN_SCHEDULERS` is on.

- **`jobs/`** — Background jobs on durable-queue (github.com/dan-mcc1/durable-queue), run in the API process by a `Runner` (worker + scheduler threads, 4 job slots, idle mode so Neon can scale to zero). A task is an `@logged_task` function in a module that `jobs/__init__.py` imports; recurring ones get an entry in `SCHEDULES`. Task names are function names and must be unique app-wide. Tasks open their own `SessionLocal()`. Inspect jobs with the `durable-queue` CLI (`stats`, `ls`, `dead`, `show`, `retry`), which reads `DURABLE_QUEUE_DATABASE_URL` from the shell environment, not from `.env`.
```

In the Backend environment variables list, after the `DURABLE_QUEUE_DATABASE_URL` entry, add:

```markdown
- `RUN_JOB_QUEUE` — Run durable-queue's worker and scheduler in this process (default true). Set false to stop background jobs on a replica, locally, or as a back-out.
```

- [ ] **Step 8: Run the whole suite**

Run: `python -m pytest tests/ -q`
Expected: `1663 passed, 25 skipped`: the baseline 1647, plus 1 from Task 1, 4 from Task 2, 7 from Task 3 and 4 here. (The moved logging test replaced the old one in place.)

- [ ] **Step 9: Commit**

```powershell
git add backend/app/config/__init__.py backend/app/main.py backend/tests/conftest.py backend/tests/test_error_logging.py backend/tests/test_jobs.py CLAUDE.md
git commit -m @'
The hourly activity cleanup now runs on durable-queue, started from the lifespan behind RUN_JOB_QUEUE. Removed the old cleanup loop so it can't run twice.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

---

### Task 5: End-to-end test on a real Postgres (optional, Docker)

**Files:**
- Create: `backend/tests/test_job_queue_postgres.py`
- Modify: `CLAUDE.md` (Testing section)

**Interfaces:**
- Consumes: `start_job_queue(dsn) -> Runner`, `stop_job_queue(runner)` (Task 3); `app.jobs.maintenance.SessionLocal` (Task 2, patched here); migration module `alembic/versions/7d1e4c2b9a50_add_durable_queue_tables.py` (its `upgrade()`).
- Produces: nothing later tasks use.

The test drops every table in the database it's pointed at. Use a container of its own, not the `durable-queue-postgres-1` container from the library repo, and never a Neon URL.

- [ ] **Step 1: Start a throwaway Postgres**

```powershell
docker run -d --name rr-queue-test-pg -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:16
```

Expected: a container id. (If the name is taken from an earlier run: `docker start rr-queue-test-pg`.)

- [ ] **Step 2: Write the test**

Create `backend/tests/test_job_queue_postgres.py`:

```python
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
    import app.jobs.maintenance as maintenance
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
    monkeypatch.setattr(maintenance, "SessionLocal", sessions)
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
```

- [ ] **Step 3: Run it without the URL to confirm it skips**

Run: `python -m pytest tests/test_job_queue_postgres.py -v`
Expected: 1 SKIPPED ("set DURABLE_QUEUE_TEST_URL to a throwaway Postgres").

- [ ] **Step 4: Run it against the container**

```powershell
$env:DURABLE_QUEUE_TEST_URL = "postgresql://postgres:pg@localhost:55432/postgres"
python -m pytest tests/test_job_queue_postgres.py -v
Remove-Item Env:DURABLE_QUEUE_TEST_URL
```

Expected: 1 PASS within about 5 s. If the assertion fails, its message is the job row `(status, attempts, last_error)`; `last_error` names the failing step. If `Base.metadata.create_all` fails on Postgres, that's a model/Postgres mismatch to report, not something to work around in this test.

- [ ] **Step 5: Document it**

In `CLAUDE.md`, append to the Testing section:

```markdown
The job queue needs Postgres, so `conftest.py` forces `RUN_JOB_QUEUE=false` and no Runner starts in the suite. `tests/test_job_queue_postgres.py` runs a scheduled job through a real queue when `DURABLE_QUEUE_TEST_URL` points at a throwaway Postgres (it drops every table there; see the file's docstring for the Docker command).
```

- [ ] **Step 6: Run the whole suite, then commit**

Run: `python -m pytest tests/ -q`
Expected: `1663 passed, 26 skipped` (the new test is the extra skip).

```powershell
git add backend/tests/test_job_queue_postgres.py CLAUDE.md
git commit -m @'
Added an end-to-end job queue test that runs the scheduled cleanup on a real Postgres. Skipped unless DURABLE_QUEUE_TEST_URL is set.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
'@
```

- [ ] **Step 7: Remove the container**

```powershell
docker rm -f rr-queue-test-pg
```

---

### Task 6: Local smoke test, then production rollout (Dan)

No code. Dan runs these: they touch the Neon dev branch and then production.

**Files:**
- Modify (local only, not committed): `backend/.env`

- [ ] **Step 1: Point the queue at the dev branch's direct endpoint**

`backend/.env` has no `DURABLE_QUEUE_DATABASE_URL` yet, so the queue would fall back to the pooler URL. Copy the active `DATABASE_URL` line, rename the key, and delete `-pooler` from the host (`ep-xxxx-pooler.c-2...` becomes `ep-xxxx.c-2...`). Everything else stays the same:

```
DURABLE_QUEUE_DATABASE_URL=postgresql://neondb_owner:<password>@ep-<name>.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

- [ ] **Step 2: Apply the migration to the dev branch**

```powershell
alembic current
alembic upgrade head
```

Expected: `current` shows `e3b7d2a9c614` (or `7d1e4c2b9a50` if it's already applied); `upgrade` prints `Running upgrade e3b7d2a9c614 -> 7d1e4c2b9a50, add_durable_queue_tables`, or nothing if already applied.

- [ ] **Step 3: Start the app and confirm the queue starts**

```powershell
uvicorn app.main:app --reload
```

Expected in the log: `INFO app.jobs: job queue started with 1 schedule(s)`, and no traceback. If it says `durable-queue's tables are missing`, Step 2 didn't apply to this database.

- [ ] **Step 4: Watch one run**

Leave the app running past the next top of the hour. Then, in a second PowerShell window in `backend/` with the venv active (the CLI doesn't read `.env`):

```powershell
$env:DURABLE_QUEUE_DATABASE_URL = "<the direct URL from Step 1>"
durable-queue stats
durable-queue ls
```

Expected: one `cleanup_activity` job, status `succeeded`. If the cleanup removed anything, the app log shows `activity cleanup: removed ...` lines.

- [ ] **Step 5: Confirm a clean shutdown and the off switch**

Stop uvicorn with Ctrl+C. Expected: it exits within a few seconds with no traceback. Then start it with the queue off:

```powershell
$env:RUN_JOB_QUEUE = "false"; uvicorn app.main:app
```

Expected log: `RUN_JOB_QUEUE=false — job queue disabled on this replica`. Stop it, then `Remove-Item Env:RUN_JOB_QUEUE`.

- [ ] **Step 6: Merge**

Use superpowers:finishing-a-development-branch to merge or open a PR for `durable-queue-foundation`.

- [ ] **Step 7: Production**

1. Set `DURABLE_QUEUE_DATABASE_URL` in the production host's environment to the production branch's direct (non-pooler) endpoint.
2. Deploy. The deploy's `alembic upgrade head` creates the queue tables; the app registers the schedule and starts the Runner (`job queue started with 1 schedule(s)` in the log).
3. After the next top of the hour, with the production direct URL in `$env:DURABLE_QUEUE_DATABASE_URL`: `durable-queue stats` and `durable-queue ls` show one `cleanup_activity` job, `succeeded`.
4. To back out without a deploy: set `RUN_JOB_QUEUE=false` and restart. Cleanup then stops until the queue is back on or the old loop is restored.
