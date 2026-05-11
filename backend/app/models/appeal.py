from sqlalchemy import Column, Boolean, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class Appeal(Base):
    __tablename__ = "appeal"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    appeal_type = Column(String, nullable=False)  # "suspension" or "ban"
    message = Column(Text, nullable=False)
    request_unsilence = Column(Boolean, default=False, server_default="false", nullable=False)
    status = Column(String, default="pending", nullable=False)  # pending, approved, rejected
    admin_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
