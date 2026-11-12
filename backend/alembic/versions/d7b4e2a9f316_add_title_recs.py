"""add_title_recs

Stores each tracked title's recommended titles (title_recs) and what For You
needs to display them (rec_candidate), so For You is built from the database
instead of from TMDb requests on every visit.

Revision ID: d7b4e2a9f316
Revises: b3f6c8d1e5a7
Create Date: 2026-11-11 23:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "d7b4e2a9f316"
down_revision: Union[str, Sequence[str], None] = "b3f6c8d1e5a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "title_recs",
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("origin", sa.String(), server_default="tmdb", nullable=False),
        sa.Column("recs", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("content_type", "content_id", "origin"),
    )
    op.create_index("ix_title_recs_fetched_at", "title_recs", ["fetched_at"])

    op.create_table(
        "rec_candidate",
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("poster_path", sa.String(), nullable=True),
        sa.Column("backdrop_path", sa.String(), nullable=True),
        sa.Column("release_date", sa.String(), nullable=True),
        sa.Column("vote_average", sa.Float(), nullable=True),
        sa.Column("popularity", sa.Float(), nullable=True),
        sa.Column("genre_ids", sa.JSON(), nullable=True),
        sa.Column("seen_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("content_type", "content_id"),
    )


def downgrade() -> None:
    op.drop_table("rec_candidate")
    op.drop_index("ix_title_recs_fetched_at", table_name="title_recs")
    op.drop_table("title_recs")
