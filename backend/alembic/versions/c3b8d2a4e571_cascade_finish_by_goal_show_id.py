"""cascade_finish_by_goal_show_id

Revision ID: c3b8d2a4e571
Revises: f7d2a3e1b609
Create Date: 2026-05-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3b8d2a4e571'
down_revision: Union[str, Sequence[str], None] = 'f7d2a3e1b609'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('finish_by_goal_show_id_fkey', 'finish_by_goal', type_='foreignkey')
    op.create_foreign_key(
        'finish_by_goal_show_id_fkey',
        'finish_by_goal', 'show',
        ['show_id'], ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('finish_by_goal_show_id_fkey', 'finish_by_goal', type_='foreignkey')
    op.create_foreign_key(
        'finish_by_goal_show_id_fkey',
        'finish_by_goal', 'show',
        ['show_id'], ['id'],
    )
