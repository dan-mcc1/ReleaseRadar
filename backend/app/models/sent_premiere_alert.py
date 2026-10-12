from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class SentPremiereAlert(Base):
    """A season-premiere alert sent to a user, so each lead (30 or 7 days)
    goes out once. Keyed by season number, not TMDb's season id, which TMDb
    reissues."""

    __tablename__ = "sent_premiere_alert"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    show_id = Column(Integer, nullable=False)
    season_number = Column(Integer, nullable=False)
    lead_days = Column(Integer, nullable=False)
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "show_id", "season_number", "lead_days",
            name="uq_sent_premiere_alert",
        ),
    )
