from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class SentEpisodeAlert(Base):
    """Idempotency record for episode air-time push notifications."""

    __tablename__ = "sent_episode_alert"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    episode_id = Column(
        Integer, ForeignKey("episode.id", ondelete="CASCADE"), nullable=False
    )
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "episode_id", name="uq_sent_episode_alert"),
    )
