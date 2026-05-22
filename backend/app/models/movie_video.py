from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base import Base


class MovieVideo(Base):
    __tablename__ = "movie_video"

    id = Column(Integer, primary_key=True, autoincrement=True)
    movie_id = Column(Integer, ForeignKey("movie.id", ondelete="CASCADE"), nullable=False, index=True)
    video_key = Column(String, nullable=False)
    name = Column(String, nullable=True)
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
