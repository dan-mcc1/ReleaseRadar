from sqlalchemy import Column, DateTime, String, Integer, ForeignKey
from app.db.base import Base


class UserStreamingService(Base):
    __tablename__ = "user_streaming_service"

    user_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    provider_id = Column(Integer, ForeignKey("provider.id", ondelete="CASCADE"), primary_key=True)
    # Set when the user says they've paused this subscription. Only drives
    # ReleaseRadar's resume reminders; it doesn't touch the real subscription.
    paused_at = Column(DateTime(timezone=True), nullable=True)
    # No separate unique constraint: the composite primary key already is one,
    # and Postgres never created the duplicate this model used to declare.
