from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class SentResumeReminder(Base):
    """A "time to resume <service>" reminder sent to a user, so each one goes
    out once. Keyed by the title and the date it lands, so a later season of
    the same show earns its own reminder. provider_id is the canonical id."""
    __tablename__ = "sent_resume_reminder"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    provider_id = Column(Integer, nullable=False)
    content_type = Column(String, nullable=False)  # 'tv' | 'movie'
    content_id = Column(Integer, nullable=False)
    release_date = Column(Date, nullable=False)
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "provider_id", "content_type", "content_id", "release_date",
            name="uq_sent_resume_reminder",
        ),
    )
