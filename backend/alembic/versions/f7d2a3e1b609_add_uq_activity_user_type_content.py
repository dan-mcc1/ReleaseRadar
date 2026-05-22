"""add_uq_activity_user_type_content

Revision ID: f7d2a3e1b609
Revises: a1f3e9b2c845
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f7d2a3e1b609'
down_revision: Union[str, Sequence[str], None] = 'a1f3e9b2c845'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Deduplicate before adding the constraint — existing duplicates would
    # cause the CREATE UNIQUE INDEX to fail.
    op.execute("""
        DELETE FROM activity a
        USING activity b
        WHERE a.id < b.id
          AND a.user_id = b.user_id
          AND a.activity_type = b.activity_type
          AND a.content_type = b.content_type
          AND a.content_id = b.content_id
          AND a.activity_type <> 'episode_watched'
    """)

    op.create_index(
        'uq_activity_user_type_content',
        'activity',
        ['user_id', 'activity_type', 'content_type', 'content_id'],
        unique=True,
        postgresql_where=sa.text("activity_type <> 'episode_watched'"),
    )


def downgrade() -> None:
    op.drop_index('uq_activity_user_type_content', table_name='activity')
