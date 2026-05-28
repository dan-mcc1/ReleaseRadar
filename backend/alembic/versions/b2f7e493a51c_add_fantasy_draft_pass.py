"""add_fantasy_draft_pass

Adds the fantasy_draft_pass table so players can drop out of bidding on a
nomination. When everyone except the high bidder has passed, the auction
auto-closes.

Revision ID: b2f7e493a51c
Revises: a8f3c61d2e94
Create Date: 2026-05-28 02:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2f7e493a51c"
down_revision: Union[str, Sequence[str], None] = "a8f3c61d2e94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fantasy_draft_pass",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nomination_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column(
            "passed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["nomination_id"],
            ["fantasy_draft_nomination.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "nomination_id", "user_id", name="uq_fantasy_draft_pass"
        ),
    )
    op.create_index(
        op.f("ix_fantasy_draft_pass_nomination_id"),
        "fantasy_draft_pass",
        ["nomination_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_fantasy_draft_pass_nomination_id"),
        table_name="fantasy_draft_pass",
    )
    op.drop_table("fantasy_draft_pass")
