"""add_friendship_status_check

Revision ID: 0bda5db5c752
Revises: c9f3a812d047
Create Date: 2026-05-21 20:50:23.298841

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '0bda5db5c752'
down_revision: Union[str, Sequence[str], None] = 'c9f3a812d047'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_friendship_status",
        "friendship",
        "status IN ('pending', 'accepted', 'declined', 'following', 'withdrawn')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_friendship_status", "friendship", type_="check")
