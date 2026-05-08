from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Rewatch(Base):
    __tablename__ = "rewatch"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, index=True, nullable=False)
    content_type = Column(String, nullable=False)  # "movie" or "tv"
    content_id = Column(Integer, nullable=False)
    watched_at = Column(DateTime(timezone=True), server_default=func.now())
    rating = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    would_rewatch = Column(Boolean, nullable=True)

    __table_args__ = (
        Index("ix_rewatch_user_content", "user_id", "content_type", "content_id"),
    )
