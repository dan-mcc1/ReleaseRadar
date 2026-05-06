from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Index, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class CurrentlyWatching(Base):
    __tablename__ = "currently_watching"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id"), index=True)
    content_type = Column(String)  # 'movie' or 'tv'
    content_id = Column(Integer)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "content_type", "content_id", name="uq_currently_watching_user_content"),
        Index("ix_currently_watching_user_content", "user_id", "content_type", "content_id"),
    )
