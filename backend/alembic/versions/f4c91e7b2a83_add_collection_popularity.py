"""add_collection_popularity

Adds the `popularity` aggregate column to `collection`. Backfilled from the
next ingest sweep — existing rows stay NULL until then.

Revision ID: f4c91e7b2a83
Revises: e1a8c3f9b240
Create Date: 2026-05-24 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4c91e7b2a83"
down_revision: Union[str, Sequence[str], None] = "e1a8c3f9b240"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "collection",
        sa.Column("popularity", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_collection_popularity", "collection", ["popularity"]
    )


def downgrade() -> None:
    op.drop_index("ix_collection_popularity", table_name="collection")
    op.drop_column("collection", "popularity")
