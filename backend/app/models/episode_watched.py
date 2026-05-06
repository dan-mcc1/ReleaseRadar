# src/models/episode_watched.py
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float, Index, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class EpisodeWatched(Base):
    __tablename__ = "episode_watched"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id"), index=True)
    show_id = Column(Integer, ForeignKey("show.id"))
    episode_id = Column(Integer, ForeignKey("episode.id"), nullable=True)
    season_number = Column(Integer)
    episode_number = Column(Integer)
    watched_at = Column(DateTime(timezone=True), server_default=func.now())
    rating = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "show_id", "season_number", "episode_number", name="uq_episode_watched_user_episode"),
        Index("ix_episode_watched_user_show", "user_id", "show_id"),
        Index("ix_episode_watched_show", "show_id"),
    )
