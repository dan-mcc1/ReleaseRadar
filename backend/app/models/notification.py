from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, Text, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Notification(Base):
    __tablename__ = "notification"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    # 'season_premiere' | 'streaming_change' | 'trailer' | 'episode_air' | 'digest'
    type = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    # Optional pointer to content; the client uses these to build a deep link.
    content_type = Column(String, nullable=True)  # 'tv' | 'movie'
    content_id = Column(Integer, nullable=True)
    image_url = Column(String, nullable=True)
    # Typed routing fields — only set for notification types that need them.
    season_number = Column(Integer, nullable=True)
    episode_id = Column(
        Integer,
        ForeignKey("episode.id", ondelete="SET NULL"),
        nullable=True,
    )
    video_key = Column(String, nullable=True)
    # Source-row pointers for notifications that mirror a row in another table.
    # CASCADE so deleting/expiring the source automatically removes the inbox
    # entry, keeping badge counts and history in sync with no stale rows.
    recommendation_id = Column(
        Integer,
        ForeignKey("recommendation.id", ondelete="CASCADE"),
        nullable=True,
    )
    friendship_id = Column(
        Integer,
        ForeignKey("friendship.id", ondelete="CASCADE"),
        nullable=True,
    )
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    __table_args__ = (
        # Powers the badge count and inbox queries — partial-style composite.
        Index("ix_notification_user_unread", "user_id", "read_at"),
        Index("ix_notification_user_created", "user_id", "created_at"),
    )
