from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Boolean, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Recommendation(Base):
    __tablename__ = "recommendation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sender_id = Column(String, ForeignKey("user.id"), nullable=False, index=True)
    recipient_id = Column(String, ForeignKey("user.id"), nullable=False, index=True)
    content_type = Column(String, nullable=False)        # 'movie' or 'tv'
    content_id = Column(Integer, nullable=False)
    content_title = Column(Text, nullable=True)
    content_poster_path = Column(Text, nullable=True)
    message = Column(Text, nullable=True)
    is_read = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_recommendation_recipient_read_created", "recipient_id", "is_read", "created_at"),
        Index("ix_recommendation_created_at", "created_at"),
    )
