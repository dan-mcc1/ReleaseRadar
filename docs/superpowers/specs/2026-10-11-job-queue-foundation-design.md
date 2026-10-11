# Job queue foundation: durable-queue in ReleaseRadar

Date: 2026-10-11
Status: approved design, awaiting spec review

## Goal

Run ReleaseRadar's background work on durable-queue
(github.com/dan-mcc1/durable-queue) instead of asyncio loops and FastAPI
BackgroundTasks, so a crash or deploy no longer loses work, missed runs catch
up, and running several processes never doubles a job.

This spec covers only the foundation: the plumbing, plus moving one
low-stakes job (the hourly activity cleanup) to prove it end to end in
production. Every other job moves in its own later change (see Follow-ups).

## Already in place

- Migration `7d1e4c2b9a50` creates `jobs`, `effects` and `schedules`;
  `alembic/env.py` excludes them from autogenerate (`QUEUE_TABLES`).
- `requirements.txt` pins durable-queue to commit `5be31a9` and psycopg 3.3.6.
  psycopg2 stays as SQLAlchemy's driver. Moving the app to psycopg 3 is a
  separate, later change.
- `DURABLE_QUEUE_DATABASE_URL` is the direct (non-pooler) Neon endpoint; the
  API keeps `DATABASE_URL` on the pooler. Same database.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where jobs run | `durable_queue.runner.Runner` inside the API process | No extra service; idle mode lets Neon scale to zero; an enqueue in the API wakes the worker at once |
| Worker concurrency | 4 | Jobs are mostly waiting on TMDb/Resend; small enough to stay light on memory |
| Switch | New setting `RUN_JOB_QUEUE`, default `True` | Can be turned off per replica or locally without touching the old loops' `RUN_SCHEDULERS` |
| First job | Hourly activity cleanup | Nothing breaks if it misbehaves; proves schedule → worker → database in production |

## Components

### `app/jobs/` package

- `app/jobs/maintenance.py`: `@task def cleanup_activity()`. Opens its own
  `SessionLocal()` and does what `_activity_cleanup_loop` does today:
  `delete_old_activity`, `delete_old_recommendations`,
  `lift_expired_moderation`, logging the counts. Each of those commits itself.
- `app/jobs/__init__.py`:
  - imports every task module so `@task` registers it with durable-queue;
  - `SCHEDULES`: a list of `(name, task_name, args, when)`, starting with
    `("activity-cleanup", "cleanup_activity", {}, hourly(0))`;
  - `start_job_queue() -> Runner`: registers every schedule over a psycopg 3
    connection from `durable_queue.db.get_connection()` (uses
    `DURABLE_QUEUE_DATABASE_URL`, falling back to `DATABASE_URL`), then
    creates and starts `Runner(concurrency=4)`;
  - `stop_job_queue(runner)`: `runner.stop()`, letting running jobs finish
    for up to the worker's 30 s `shutdown_timeout`.

Task names come from function names and durable-queue's registry is global,
so names must be unique across the app.

Registering schedules on every boot is safe: re-registering updates a
schedule's task, args and timing but leaves its `next_run_at` alone.

### `app/main.py`

- Lifespan: if `settings.RUN_JOB_QUEUE`, call `start_job_queue()` before
  `yield`; after `yield`, `await asyncio.to_thread(stop_job_queue, runner)`.
  `Runner.start()` opens one connection up front, so an unreachable database
  fails the app's startup loudly rather than on a background thread.
- Remove `_activity_cleanup_loop` and its task, so the cleanup never runs
  twice. The other seven loops stay on `RUN_SCHEDULERS` until each moves.

### `app/config`

- `RUN_JOB_QUEUE: bool = True`.

### `app/core/logging.py`

- `setup_logging()` gives the `durable_queue` logger the same handler and
  INFO level as `app`, so the library's retry, crash and restart messages
  come out formatted (they reach Sentry either way).

## Data flow

Startup registers schedules and starts the Runner's worker and scheduler
threads in idle mode (no queries while nothing is due). At the top of each
hour the scheduler enqueues a `cleanup_activity` job, keyed by the schedule's
slot so a slot can't fire twice; the worker in the same process wakes, claims
it under a lease, runs it, and marks it succeeded. If the process dies
mid-job, the lease lapses and the job runs again. If the app was down across
one or more top-of-the-hour slots, the scheduler runs the job once, for the
most recent missed slot, when it comes back (no `max_lateness_seconds` is
set, so it never skips).

## Error handling

- A task that raises is retried with backoff by durable-queue (default 5
  attempts), then marked dead. `durable-queue dead` lists dead jobs.
- `cleanup_activity` is safe to run twice: each step deletes or clears rows
  past a cutoff.
- A crash in the Runner's loops is logged and the loop restarts after 5 s
  (durable-queue's `Runner`).

## Testing

The suite stays on in-memory SQLite. durable-queue's SQL is Postgres-only
(`FOR UPDATE SKIP LOCKED`, `jsonb`, `pg_notify`), so unit tests don't touch
the queue tables. The test client doesn't run the lifespan, so no Runner
starts during tests.

- `cleanup_activity`: activity and recommendations past their cutoffs are
  deleted and newer ones kept; expired suspensions and silences are lifted.
- Every entry in `SCHEDULES` names a registered task (catches a typo or a
  task module that isn't imported).
- Lifespan with `RUN_JOB_QUEUE` off creates no Runner; with it on, the
  Runner is started and then stopped (Runner patched; no database needed).
- `test_error_logging`'s scheduler-loop test moves from the deleted
  `_activity_cleanup_loop` to `_episode_alert_loop`, which also does work
  before its first sleep.
- Optional integration test, skipped unless `DURABLE_QUEUE_TEST_URL` points
  at a Postgres (Docker): migrate, register the schedule with its slot due,
  run the Runner briefly, and check the cleanup happened and the job
  succeeded.

## Rollout

1. Set `DURABLE_QUEUE_DATABASE_URL` in the host's environment (production
   branch's direct endpoint).
2. Deploy. The deploy's `alembic upgrade head` creates the queue tables, then
   the app registers the schedule and starts the Runner.
3. Check with `durable-queue stats` (and `durable-queue ls`) after the next
   top of the hour: one `cleanup_activity` job, succeeded.
4. To back out without a deploy, set `RUN_JOB_QUEUE=false` and restart.
   Cleanup then stops until the old loop is restored or the queue is back on.

## Out of scope

- Moving any job other than the activity cleanup.
- Switching the app to psycopg 3.
- Transactional (`conn`-parameter) tasks: ReleaseRadar's services use
  SQLAlchemy sessions, so tasks open their own `SessionLocal()`.

## Follow-ups (each its own change)

1. 3am episode refresh, one job per show, with that show's reactivation
   check right after its refresh; vote update and prune as their own
   schedules.
2. Work after adding a title (populate, episode sync, providers, trailers),
   enqueued in the add's transaction via `durable_queue.sqlalchemy.enqueue`
   with idempotency keys.
3. Streaming and trailer refresh, one job per title.
4. Digest, one job per user, with a Resend idempotency key and an "at or
   after the chosen hour, not sent today" condition.
5. Episode alerts, collections sync, Stripe reconcile.
6. Imports (decided design: client-neutral API, parsed rows stored on the
   job, progress page, notification when done; `event_bus.publish` made
   thread-safe).
7. Remove `RUN_SCHEDULERS` once no loop uses it.
