"""add_durable_queue_tables

The jobs, effects and schedules tables used by durable-queue
(github.com/dan-mcc1/durable-queue), copied from its sql/schema.sql without
the test-only tables. They aren't ORM models, so alembic/env.py excludes them
from autogenerate (QUEUE_TABLES) to stop it proposing to drop them.

Revision ID: 7d1e4c2b9a50
Revises: e3b7d2a9c614
Create Date: 2026-10-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "7d1e4c2b9a50"
down_revision: Union[str, Sequence[str], None] = "e3b7d2a9c614"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE jobs (
            id              bigserial PRIMARY KEY,
            task            text        NOT NULL,
            args            jsonb       NOT NULL DEFAULT '{}',
            idempotency_key text        UNIQUE,
            status          text        NOT NULL DEFAULT 'pending',
            run_at          timestamptz NOT NULL DEFAULT now(),
            attempts        int         NOT NULL DEFAULT 0,
            max_attempts    int         NOT NULL DEFAULT 5,
            recoveries      int         NOT NULL DEFAULT 0,
            max_recoveries  int         NOT NULL DEFAULT 10,
            locked_by       text,
            locked_until    timestamptz,
            last_error      text,
            created_at      timestamptz NOT NULL DEFAULT now(),
            finished_at     timestamptz
        );
        CREATE INDEX idx_jobs_pending_run_at ON jobs (run_at, id) WHERE status = 'pending';
        CREATE INDEX idx_jobs_running_locked_until ON jobs (locked_until) WHERE status = 'running';

        CREATE TABLE effects (
            key        text        PRIMARY KEY,
            created_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE schedules (
            name                 text        PRIMARY KEY,
            task                 text        NOT NULL,
            args                 jsonb       NOT NULL DEFAULT '{}',
            interval_seconds     int,
            every                text        CHECK (every IN ('hour', 'day')),
            at_time              time,
            time_zone            text,
            max_lateness_seconds int,
            next_run_at          timestamptz NOT NULL DEFAULT now(),
            created_at           timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT schedules_interval_or_clock CHECK ((interval_seconds IS NULL) <> (every IS NULL)),
            CONSTRAINT schedules_clock_complete
                CHECK (every IS NULL OR (at_time IS NOT NULL AND time_zone IS NOT NULL))
        );
    """)


def downgrade() -> None:
    op.execute("DROP TABLE schedules, effects, jobs")
