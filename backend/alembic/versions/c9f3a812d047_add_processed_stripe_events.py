"""add_processed_stripe_events

Revision ID: c9f3a812d047
Revises: bab0812a7a21
Create Date: 2026-05-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c9f3a812d047'
down_revision: Union[str, Sequence[str], None] = 'bab0812a7a21'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'processed_stripe_events',
        sa.Column('event_id', sa.String(), primary_key=True),
        sa.Column(
            'processed_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table('processed_stripe_events')
