# src/models/user.py
from sqlalchemy import Column, String, DateTime, Boolean
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
