"""add_display_name_to_user

Revision ID: 7a4e1c92f8b3
Revises: 99c0ab3a26cf
Create Date: 2026-05-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "7a4e1c92f8b3"
down_revision: Union[str, Sequence[str], None] = "99c0ab3a26cf"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("user", sa.Column("display_name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("user", "display_name")
