# app/models/friendship.py
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class Friendship(Base):
    __tablename__ = "friendship"

    id = Column(Integer, primary_key=True, autoincrement=True)
    requester_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    addressee_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    # status: 'pending' | 'accepted' | 'declined'
    status = Column(String, nullable=False, default="pending")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # Each pair can only have one relationship row (stored with consistent ordering via service)
        UniqueConstraint("requester_id", "addressee_id", name="uq_friendship_pair"),
    )
