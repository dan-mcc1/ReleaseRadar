"""notification_source_fks

Link notification rows to their source recommendation / friendship row
so lifecycle changes (mark read, delete, accept, decline, TTL expire)
keep the inbox + badge count in sync via CASCADE.

Revision ID: a3d52f81c4e6
Revises: f4c91e7b2a83
Create Date: 2026-05-24 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a3d52f81c4e6"
down_revision: Union[str, Sequence[str], None] = "f4c91e7b2a83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification",
        sa.Column(
            "recommendation_id",
            sa.Integer(),
            sa.ForeignKey("recommendation.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "notification",
        sa.Column(
            "friendship_id",
            sa.Integer(),
            sa.ForeignKey("friendship.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("notification", "friendship_id")
    op.drop_column("notification", "recommendation_id")
