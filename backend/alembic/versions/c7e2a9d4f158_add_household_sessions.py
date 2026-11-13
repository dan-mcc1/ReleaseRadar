"""add_household_sessions

Swipe-to-match for households: a session snapshots tonight's picks for the
people watching (household_session), and each person's yes/no per title is
a household_session_vote.

Revision ID: c7e2a9d4f158
Revises: b4d9f2a6c813
Create Date: 2026-11-13 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c7e2a9d4f158"
down_revision: Union[str, Sequence[str], None] = "b4d9f2a6c813"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "household_session",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("household_id", sa.Integer(),
                  sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.String(),
                  sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("participants", sa.JSON(), nullable=False),
        sa.Column("candidates", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), server_default="open", nullable=False),
        sa.Column("picked_type", sa.String(), nullable=True),
        sa.Column("picked_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_household_session_household_id", "household_session", ["household_id"])
    op.create_table(
        "household_session_vote",
        sa.Column("session_id", sa.Integer(),
                  sa.ForeignKey("household_session.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(),
                  sa.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("content_type", sa.String(), primary_key=True),
        sa.Column("content_id", sa.Integer(), primary_key=True),
        sa.Column("vote", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("household_session_vote")
    op.drop_index("ix_household_session_household_id", table_name="household_session")
    op.drop_table("household_session")
