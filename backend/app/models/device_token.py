from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Index
from sqlalchemy.sql import func
from app.db.base import Base


class DeviceToken(Base):
    __tablename__ = "device_token"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token = Column(String, nullable=False, unique=True)
    platform = Column(String, nullable=False)  # 'ios' | 'android'
    app_version = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    disabled_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_device_token_user_active", "user_id", "disabled_at"),
    )
