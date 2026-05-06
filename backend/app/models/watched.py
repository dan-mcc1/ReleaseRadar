# src/models/movie_watched.py
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float, Index, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class Watched(Base):
    __tablename__ = "watched"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id"), index=True)
    content_type = Column(String)
    content_id = Column(Integer)
    watched_at = Column(DateTime(timezone=True), server_default=func.now())
    rating = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "content_type", "content_id", name="uq_watched_user_content"),
        Index("ix_watched_user_content", "user_id", "content_type", "content_id"),
    )
