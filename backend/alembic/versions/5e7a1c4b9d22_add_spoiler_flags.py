"""add_spoiler_flags

Revision ID: 5e7a1c4b9d22
Revises: 3b5d8e2a91c0
Create Date: 2026-05-24 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "5e7a1c4b9d22"
down_revision: Union[str, Sequence[str], None] = "3b5d8e2a91c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "review",
        sa.Column(
            "is_spoiler",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "hide_spoilers",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "hide_spoilers")
    op.drop_column("review", "is_spoiler")
