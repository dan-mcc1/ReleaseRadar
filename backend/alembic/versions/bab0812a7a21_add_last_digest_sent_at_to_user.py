"""add_last_digest_sent_at_to_user

Revision ID: bab0812a7a21
Revises: 60b8575069ab
Create Date: 2026-05-21 01:05:54.101227

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'bab0812a7a21'
down_revision: Union[str, Sequence[str], None] = '60b8575069ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('user', sa.Column('last_digest_sent_at', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('user', 'last_digest_sent_at')
