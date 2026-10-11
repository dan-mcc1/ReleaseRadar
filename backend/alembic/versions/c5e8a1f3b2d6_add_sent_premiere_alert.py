"""add_sent_premiere_alert

Records each season-premiere alert sent to a user, so the alerts can run as
retryable jobs without sending twice. The backfill marks alerts the old
exact-day sweep had already sent (or would have skipped), so the first run
of the new jobs doesn't repeat them.

Revision ID: c5e8a1f3b2d6
Revises: 7d1e4c2b9a50
Create Date: 2026-10-11 18:00:00.000000

"""
from datetime import date, timedelta
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c5e8a1f3b2d6"
down_revision: Union[str, Sequence[str], None] = "7d1e4c2b9a50"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Every (tracker, season) pair the old sweep alerted: Watchlist with notify
# on, or Watched. DISTINCT folds a show on both lists, and two Season rows
# for one season, into one row. Dates are bound parameters, so the SQL runs
# on Postgres and on the tests' SQLite alike.
_BACKFILL = sa.text("""
    INSERT INTO sent_premiere_alert (user_id, show_id, season_number, lead_days)
    SELECT DISTINCT t.user_id, s.show_id, s.season_number, :lead_days
    FROM season s
    JOIN (
        SELECT user_id, content_id FROM watchlist
        WHERE content_type = 'tv' AND notify
        UNION
        SELECT user_id, content_id FROM watched
        WHERE content_type = 'tv'
    ) t ON t.content_id = s.show_id
    WHERE s.season_number > 0 AND s.air_date BETWEEN :first AND :last
""")


def _backfill(conn, today: date) -> None:
    """Mark as sent each alert whose day under the old system (exactly 30 or
    7 days before the premiere) has already passed. Seasons exactly 30 or 7
    days out aren't marked, so they get today's alert as before."""
    for lead_days, last in ((30, 29), (7, 6)):
        conn.execute(_BACKFILL, {
            "lead_days": lead_days,
            # ISO strings rather than dates: no driver adapter needed, and
            # both Postgres and SQLite compare them against a date column.
            "first": (today + timedelta(days=1)).isoformat(),
            "last": (today + timedelta(days=last)).isoformat(),
        })


def upgrade() -> None:
    op.create_table(
        "sent_premiere_alert",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(),
                  sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("show_id", sa.Integer(), nullable=False),
        sa.Column("season_number", sa.Integer(), nullable=False),
        sa.Column("lead_days", sa.Integer(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "show_id", "season_number", "lead_days",
                            name="uq_sent_premiere_alert"),
    )
    _backfill(op.get_bind(), date.today())


def downgrade() -> None:
    op.drop_table("sent_premiere_alert")
