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
    email_notifications = Column(Boolean, default=False, nullable=False, server_default="false")
    notification_frequency = Column(String, default="daily", nullable=False, server_default="daily")
    profile_visibility = Column(String, default="friends_only", nullable=False, server_default="friends_only")
    avatar_key = Column(String, nullable=True)
    bio = Column(String, nullable=True)
