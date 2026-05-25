"""add_push_notifications

Revision ID: d92f4a1c7b35
Revises: 8b2f4d903ec1
Create Date: 2026-05-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "d92f4a1c7b35"
down_revision: Union[str, Sequence[str], None] = "8b2f4d903ec1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- User columns: push preferences ---
    op.add_column(
        "user",
        sa.Column(
            "push_notifications_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "push_notify_new_seasons",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "push_notify_streaming_changes",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "push_notify_trailers",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "push_notify_episode_air",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
    )
    op.add_column(
        "user",
        sa.Column(
            "episode_alert_lead_minutes",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    # --- device_token ---
    op.create_table(
        "device_token",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(), nullable=False, unique=True),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("app_version", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_device_token_user_id", "device_token", ["user_id"]
    )
    op.create_index(
        "ix_device_token_user_active",
        "device_token",
        ["user_id", "disabled_at"],
    )

    # --- notification ---
    op.create_table(
        "notification",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("content_id", sa.Integer(), nullable=True),
        sa.Column("image_url", sa.String(), nullable=True),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_notification_created_at", "notification", ["created_at"]
    )
    op.create_index(
        "ix_notification_user_unread", "notification", ["user_id", "read_at"]
    )
    op.create_index(
        "ix_notification_user_created", "notification", ["user_id", "created_at"]
    )

    # --- sent_episode_alert ---
    op.create_table(
        "sent_episode_alert",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "episode_id",
            sa.Integer(),
            sa.ForeignKey("episode.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("user_id", "episode_id", name="uq_sent_episode_alert"),
    )


def downgrade() -> None:
    op.drop_table("sent_episode_alert")
    op.drop_index("ix_notification_user_created", table_name="notification")
    op.drop_index("ix_notification_user_unread", table_name="notification")
    op.drop_index("ix_notification_created_at", table_name="notification")
    op.drop_table("notification")
    op.drop_index("ix_device_token_user_active", table_name="device_token")
    op.drop_index("ix_device_token_user_id", table_name="device_token")
    op.drop_table("device_token")
    op.drop_column("user", "episode_alert_lead_minutes")
    op.drop_column("user", "push_notify_episode_air")
    op.drop_column("user", "push_notify_trailers")
    op.drop_column("user", "push_notify_streaming_changes")
    op.drop_column("user", "push_notify_new_seasons")
    op.drop_column("user", "push_notifications_enabled")
