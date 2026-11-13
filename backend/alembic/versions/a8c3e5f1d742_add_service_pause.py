"""add_service_pause

Lets a user mark a saved streaming service as paused (user_streaming_service.
paused_at), and records the resume reminders sent for paused services
(sent_resume_reminder) so each goes out once.

Revision ID: a8c3e5f1d742
Revises: f2b9d4e6a171
Create Date: 2026-11-12 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a8c3e5f1d742"
down_revision: Union[str, Sequence[str], None] = "f2b9d4e6a171"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_streaming_service",
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "sent_resume_reminder",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.String(),
                  sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_id", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("release_date", sa.Date(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "user_id", "provider_id", "content_type", "content_id", "release_date",
            name="uq_sent_resume_reminder",
        ),
    )


def downgrade() -> None:
    op.drop_table("sent_resume_reminder")
    op.drop_column("user_streaming_service", "paused_at")
