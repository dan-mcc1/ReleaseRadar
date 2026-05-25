"""collection_denorm_aggregates

Adds size / avg_rating / min_year / max_year denormalized columns to the
``collection`` table so /collections/browse can paginate from a single SELECT
with no joins. Backfills values for every collection that has parts.

Revision ID: 8b2f4d903ec1
Revises: 5e7a1c4b9d22
Create Date: 2026-05-24 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "8b2f4d903ec1"
down_revision: Union[str, Sequence[str], None] = "5e7a1c4b9d22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("collection", sa.Column("size", sa.Integer(), nullable=True))
    op.add_column("collection", sa.Column("avg_rating", sa.Float(), nullable=True))
    op.add_column("collection", sa.Column("min_year", sa.Integer(), nullable=True))
    op.add_column("collection", sa.Column("max_year", sa.Integer(), nullable=True))
    op.create_index("ix_collection_size", "collection", ["size"])
    op.create_index("ix_collection_avg_rating", "collection", ["avg_rating"])

    # One-time backfill so the browse endpoint sees a populated table the
    # moment the migration finishes. Subsequent updates happen at ingest time.
    op.execute(
        """
        UPDATE collection c
        SET
            size = agg.size,
            avg_rating = agg.avg_rating,
            min_year = agg.min_year,
            max_year = agg.max_year
        FROM (
            SELECT
                cm.collection_id AS cid,
                COUNT(cm.movie_id) AS size,
                AVG(CASE WHEN m.vote_average > 0 THEN m.vote_average END) AS avg_rating,
                MIN(EXTRACT(YEAR FROM m.release_date))::int AS min_year,
                MAX(EXTRACT(YEAR FROM m.release_date))::int AS max_year
            FROM collection_movie cm
            JOIN movie m ON m.id = cm.movie_id
            GROUP BY cm.collection_id
        ) agg
        WHERE c.id = agg.cid
        """
    )


def downgrade() -> None:
    op.drop_index("ix_collection_avg_rating", table_name="collection")
    op.drop_index("ix_collection_size", table_name="collection")
    op.drop_column("collection", "max_year")
    op.drop_column("collection", "min_year")
    op.drop_column("collection", "avg_rating")
    op.drop_column("collection", "size")
