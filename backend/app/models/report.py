from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Index
from sqlalchemy.sql import func
from app.db.base import Base


class Report(Base):
    __tablename__ = "report"

    id = Column(Integer, primary_key=True, autoincrement=True)
    reporter_id = Column(String, ForeignKey("user.id"), nullable=True)
    # reported_type: "review" | "user"
    reported_type = Column(String, nullable=False)
    # review ID (int as str) or user ID (firebase uid str)
    reported_id = Column(String, nullable=False)
    reason = Column(Text, nullable=False)
    message = Column(Text, nullable=True)
    # status: "pending" | "accepted" | "rejected"
    status = Column(String, nullable=False, default="pending", server_default="pending")
    admin_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_report_status", "status"),
        Index("ix_report_reporter", "reporter_id"),
    )
