from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base


class ShowVideo(Base):
    __tablename__ = "show_video"

    id = Column(Integer, primary_key=True, autoincrement=True)
    show_id = Column(Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False, index=True)
    video_key = Column(String, nullable=False)
    name = Column(String, nullable=True)
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
