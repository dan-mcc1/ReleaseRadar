"""add_households

Households (a couple, a family): members, friends-only invites and a shared
Watch together list. activity.logged_by records who logged a watch when a
housemate logs it for someone ("logged by Sam").

Revision ID: b4d9f2a6c813
Revises: a8c3e5f1d742
Create Date: 2026-11-13 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b4d9f2a6c813"
down_revision: Union[str, Sequence[str], None] = "a8c3e5f1d742"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "household",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("created_by", sa.String(),
                  sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "household_member",
        sa.Column("household_id", sa.Integer(),
                  sa.ForeignKey("household.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(),
                  sa.ForeignKey("user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(), server_default="member", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_household_member_user_id", "household_member", ["user_id"])
    op.create_table(
        "household_invite",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("household_id", sa.Integer(),
                  sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(),
                  sa.ForeignKey("user.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invited_by", sa.String(),
                  sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("household_id", "user_id", name="uq_household_invite"),
    )
    op.create_index("ix_household_invite_user_id", "household_invite", ["user_id"])
    op.create_table(
        "household_item",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("household_id", sa.Integer(),
                  sa.ForeignKey("household.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("added_by", sa.String(),
                  sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("household_id", "content_type", "content_id",
                            name="uq_household_item"),
    )
    op.create_index("ix_household_item_household_id", "household_item", ["household_id"])
    op.add_column(
        "activity",
        sa.Column("logged_by", sa.String(),
                  sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("activity", "logged_by")
    op.drop_index("ix_household_item_household_id", table_name="household_item")
    op.drop_table("household_item")
    op.drop_index("ix_household_invite_user_id", table_name="household_invite")
    op.drop_table("household_invite")
    op.drop_index("ix_household_member_user_id", table_name="household_member")
    op.drop_table("household_member")
    op.drop_table("household")
