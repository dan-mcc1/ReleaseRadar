"""add_collection_rating_score

Adds the vote-aware `rating_score` column to `collection`, used to sort by
rating. Backfilled from the next ingest sweep — existing rows stay NULL until
then.

Revision ID: a7c2e5d18f94
Revises: c7e5a91d3f48
Create Date: 2026-10-09 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7c2e5d18f94"
down_revision: Union[str, Sequence[str], None] = "c7e5a91d3f48"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "collection",
        sa.Column("rating_score", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_collection_rating_score", "collection", ["rating_score"]
    )


def downgrade() -> None:
    op.drop_index("ix_collection_rating_score", table_name="collection")
    op.drop_column("collection", "rating_score")
