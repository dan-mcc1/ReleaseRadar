"""add_season_end_date_and_ratings

Adds:
- season.end_date column (backfilled from MAX(episode.air_date))
- season_rating table for per-user, per-season star ratings

Revision ID: c7e5a91d3f48
Revises: b8a92c5e4f17
Create Date: 2026-05-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7e5a91d3f48"
down_revision: Union[str, Sequence[str], None] = "b8a92c5e4f17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "season",
        sa.Column("end_date", sa.Date(), nullable=True),
    )

    # Backfill end_date from existing episodes so the column is immediately
    # usable instead of waiting for the next nightly refresh.
    op.execute(
        """
        UPDATE season
        SET end_date = sub.max_air_date
        FROM (
            SELECT show_id, season_number, MAX(air_date) AS max_air_date
            FROM episode
            WHERE air_date IS NOT NULL
            GROUP BY show_id, season_number
        ) AS sub
        WHERE season.show_id = sub.show_id
          AND season.season_number = sub.season_number
        """
    )

    op.create_table(
        "season_rating",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "show_id",
            sa.Integer(),
            sa.ForeignKey("show.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("season_number", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Float(), nullable=False),
        sa.Column(
            "rated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.UniqueConstraint(
            "user_id",
            "show_id",
            "season_number",
            name="uq_season_rating_user_season",
        ),
    )
    op.create_index(
        "ix_season_rating_user_id", "season_rating", ["user_id"]
    )
    op.create_index(
        "ix_season_rating_show_season",
        "season_rating",
        ["show_id", "season_number"],
    )


def downgrade() -> None:
    op.drop_index("ix_season_rating_show_season", table_name="season_rating")
    op.drop_index("ix_season_rating_user_id", table_name="season_rating")
    op.drop_table("season_rating")
    op.drop_column("season", "end_date")
