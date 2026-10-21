"""end_friendships_of_blocked_pairs

Blocking a user now deletes any friendship, request or follow between the
two (routers/moderation.py). This brings blocks made before that change into
line: every Friendship row between a blocked pair, either direction, is
deleted, so friend lists, suggestions and friend checks stop showing them.
Data only, no schema change.

Revision ID: a9d4f2c7e1b3
Revises: c5e8a1f3b2d6
Create Date: 2026-10-21 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a9d4f2c7e1b3"
down_revision: Union[str, Sequence[str], None] = "c5e8a1f3b2d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Plain correlated EXISTS, so it runs on Postgres and the tests' SQLite alike.
_DELETE = sa.text("""
    DELETE FROM friendship
    WHERE EXISTS (
        SELECT 1 FROM block b
        WHERE (b.blocker_id = friendship.requester_id
               AND b.blocked_id = friendship.addressee_id)
           OR (b.blocker_id = friendship.addressee_id
               AND b.blocked_id = friendship.requester_id)
    )
""")


def upgrade() -> None:
    op.get_bind().execute(_DELETE)


def downgrade() -> None:
    # The deleted friendships can't be restored; a block ends them either way.
    pass
