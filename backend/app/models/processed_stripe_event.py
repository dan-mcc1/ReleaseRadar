from sqlalchemy import Column, String, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class ProcessedStripeEvent(Base):
    __tablename__ = "processed_stripe_events"

    event_id = Column(String, primary_key=True)
    processed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
