from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Float, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Activity(Base):
    __tablename__ = "activity"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id"), index=True)
    # activity_type: 'watched', 'currently_watching', 'want_to_watch', 'rated', 'episode_watched'
    activity_type = Column(String, nullable=False)
    content_type = Column(String, nullable=False)  # 'movie' or 'tv'
    content_id = Column(Integer, nullable=False)
    content_title = Column(Text, nullable=True)
    content_poster_path = Column(Text, nullable=True)
    rating = Column(Float, nullable=True)          # for 'rated' events
    season_number = Column(Integer, nullable=True)  # for 'episode_watched' events
    episode_number = Column(Integer, nullable=True) # for 'episode_watched' events
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_activity_user_created_at", "user_id", "created_at"),
        Index("ix_activity_created_at", "created_at"),
    )
