from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    # category: "bug" | "feature" | "general"
    category = Column(String, nullable=False)
    subject = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    # status: "open" | "reviewed" | "closed"
    status = Column(String, nullable=False, default="open", server_default="open")
    admin_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_feedback_status", "status"),
        Index("ix_feedback_category", "category"),
        Index("ix_feedback_created_at", "created_at"),
    )
