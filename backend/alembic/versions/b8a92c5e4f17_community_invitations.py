"""community_invitations

Adds the community_invitation table and the notification.community_invitation_id
foreign key. Also serves as a merge of the two parallel heads
(a3d52f81c4e6 and d4f2c8e91a73) so future migrations have a single tip.

Revision ID: b8a92c5e4f17
Revises: a3d52f81c4e6, d4f2c8e91a73
Create Date: 2026-05-25 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8a92c5e4f17"
down_revision: Union[str, Sequence[str], None] = ("a3d52f81c4e6", "d4f2c8e91a73")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "community_invitation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "community_id",
            sa.Integer(),
            sa.ForeignKey("community.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "invited_by",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "community_id", "user_id", name="uq_community_invitation"
        ),
    )
    op.create_index(
        "ix_community_invitation_community_id",
        "community_invitation",
        ["community_id"],
    )
    op.create_index(
        "ix_community_invitation_user_id",
        "community_invitation",
        ["user_id"],
    )

    op.add_column(
        "notification",
        sa.Column(
            "community_invitation_id",
            sa.Integer(),
            sa.ForeignKey("community_invitation.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("notification", "community_invitation_id")
    op.drop_index(
        "ix_community_invitation_user_id", table_name="community_invitation"
    )
    op.drop_index(
        "ix_community_invitation_community_id", table_name="community_invitation"
    )
    op.drop_table("community_invitation")
