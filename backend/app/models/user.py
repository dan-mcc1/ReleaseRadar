# src/models/user.py
from sqlalchemy import Column, String, DateTime, Boolean, Text, Integer
from sqlalchemy.sql import func
from app.db.base import Base


class User(Base):
    __tablename__ = "user"

    id = Column(String, primary_key=True)  # Firebase UID
    email = Column(String, nullable=True)
    username = Column(String, unique=True, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    email_notifications = Column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    notification_frequency = Column(
        String, default="daily", nullable=False, server_default="daily"
    )
    profile_visibility = Column(
        String, default="friends_only", nullable=False, server_default="friends_only"
    )
    avatar_key = Column(String, nullable=True)
    bio = Column(String, nullable=True)
    subscription_tier = Column(String, default="free", server_default="free", nullable=False)
    notify_new_seasons = Column(Boolean, default=True, server_default="true", nullable=False)
    notify_streaming_changes = Column(Boolean, default=True, server_default="true", nullable=False)
    onboarding_completed = Column(Boolean, default=False, server_default="false", nullable=False)
    is_suspended = Column(Boolean, default=False, server_default="false", nullable=False)
    suspended_until = Column(DateTime(timezone=True), nullable=True)
    suspension_reason = Column(Text, nullable=True)
    warning_count = Column(Integer, default=0, server_default="0", nullable=False)
    has_unread_warning = Column(Boolean, default=False, server_default="false", nullable=False)
    is_banned = Column(Boolean, default=False, server_default="false", nullable=False)
    ban_reason = Column(Text, nullable=True)
    is_silenced = Column(Boolean, default=False, server_default="false", nullable=False)
    silenced_until = Column(DateTime(timezone=True), nullable=True)
