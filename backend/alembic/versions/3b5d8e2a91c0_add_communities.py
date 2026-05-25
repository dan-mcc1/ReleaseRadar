"""add_communities

Revision ID: 3b5d8e2a91c0
Revises: 7a4e1c92f8b3
Create Date: 2026-05-24 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "3b5d8e2a91c0"
down_revision: Union[str, Sequence[str], None] = "7a4e1c92f8b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "community",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(length=60), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("banner_color", sa.String(length=20), nullable=True),
        sa.Column("visibility", sa.String(), nullable=False, server_default="public"),
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("member_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_slug", "community", ["slug"], unique=True)

    op.create_table(
        "community_member",
        sa.Column(
            "community_id",
            sa.Integer(),
            sa.ForeignKey("community.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("role", sa.String(), nullable=False, server_default="member"),
        sa.Column(
            "joined_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_member_user", "community_member", ["user_id"])

    op.create_table(
        "community_media",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "community_id",
            sa.Integer(),
            sa.ForeignKey("community.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_type", sa.String(), nullable=False),
        sa.Column("content_id", sa.Integer(), nullable=False),
        sa.Column("added_by", sa.String(), sa.ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "added_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "community_id", "content_type", "content_id", name="uq_community_media"
        ),
    )
    op.create_index("ix_community_media_community", "community_media", ["community_id"])

    op.create_table(
        "community_post",
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
        sa.Column("title", sa.String(length=150), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("reply_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_post_community", "community_post", ["community_id"])
    op.create_index("ix_community_post_created_at", "community_post", ["created_at"])

    op.create_table(
        "community_reply",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "post_id",
            sa.Integer(),
            sa.ForeignKey("community_post.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("like_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_reply_post", "community_reply", ["post_id"])

    op.create_table(
        "community_post_like",
        sa.Column(
            "post_id",
            sa.Integer(),
            sa.ForeignKey("community_post.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_post_like_user", "community_post_like", ["user_id"])

    op.create_table(
        "community_reply_like",
        sa.Column(
            "reply_id",
            sa.Integer(),
            sa.ForeignKey("community_reply.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_community_reply_like_user", "community_reply_like", ["user_id"])


def downgrade() -> None:
    op.drop_table("community_reply_like")
    op.drop_table("community_post_like")
    op.drop_table("community_reply")
    op.drop_table("community_post")
    op.drop_table("community_media")
    op.drop_table("community_member")
    op.drop_table("community")
