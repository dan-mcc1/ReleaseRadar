"""add_ical_token_version

Revision ID: 60b8575069ab
Revises: 916be32eabdf
Create Date: 2026-05-21 01:00:13.715972

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60b8575069ab'
down_revision: Union[str, Sequence[str], None] = '916be32eabdf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user",
        sa.Column(
            "ical_token_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "ical_token_version")
