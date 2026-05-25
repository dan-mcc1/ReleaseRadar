"""normalize_notification_columns

Replace the JSONB `data` column on `notification` with typed columns:
`season_number`, `episode_id`, `video_key`.

Revision ID: e1a8c3f9b240
Revises: d92f4a1c7b35
Create Date: 2026-05-24 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "e1a8c3f9b240"
down_revision: Union[str, Sequence[str], None] = "d92f4a1c7b35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notification",
        sa.Column("season_number", sa.Integer(), nullable=True),
    )
    op.add_column(
        "notification",
        sa.Column(
            "episode_id",
            sa.Integer(),
            sa.ForeignKey("episode.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "notification",
        sa.Column("video_key", sa.String(), nullable=True),
    )
    op.drop_column("notification", "data")


def downgrade() -> None:
    op.add_column(
        "notification",
        sa.Column(
            "data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
    )
    op.drop_column("notification", "video_key")
    op.drop_column("notification", "episode_id")
    op.drop_column("notification", "season_number")
