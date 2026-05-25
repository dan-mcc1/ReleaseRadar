"""add_community_members_can_edit_media

Revision ID: d4f2c8e91a73
Revises: b6e2f8a14d31
Create Date: 2026-05-25 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4f2c8e91a73"
down_revision: Union[str, Sequence[str], None] = "b6e2f8a14d31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "community",
        sa.Column(
            "members_can_edit_media",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("community", "members_can_edit_media")
