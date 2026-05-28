"""add_fantasy_league_invitation

Adds the fantasy_league_invitation table so adding members goes through an
invite-accept flow instead of being instant.

Revision ID: a8f3c61d2e94
Revises: d5c9ef31b6a8
Create Date: 2026-05-28 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a8f3c61d2e94"
down_revision: Union[str, Sequence[str], None] = "d5c9ef31b6a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "fantasy_league_invitation",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("league_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("invited_by", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["invited_by"], ["user.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["league_id"], ["fantasy_league.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "league_id", "user_id", name="uq_fantasy_league_invitation"
        ),
    )
    op.create_index(
        op.f("ix_fantasy_league_invitation_league_id"),
        "fantasy_league_invitation",
        ["league_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_fantasy_league_invitation_user_id"),
        "fantasy_league_invitation",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_fantasy_league_invitation_user_id"),
        table_name="fantasy_league_invitation",
    )
    op.drop_index(
        op.f("ix_fantasy_league_invitation_league_id"),
        table_name="fantasy_league_invitation",
    )
    op.drop_table("fantasy_league_invitation")
