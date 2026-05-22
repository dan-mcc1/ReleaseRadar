from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Block(Base):
    __tablename__ = "block"

    id = Column(Integer, primary_key=True, autoincrement=True)
    blocker_id = Column(String, ForeignKey("user.id"), nullable=False)
    blocked_id = Column(String, ForeignKey("user.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
        Index("ix_block_blocker", "blocker_id"),
        Index("ix_block_blocked", "blocked_id"),
    )
