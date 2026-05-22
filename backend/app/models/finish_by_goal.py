from sqlalchemy import Column, Integer, String, Date, ForeignKey, UniqueConstraint, Index
from app.db.base import Base


class FinishByGoal(Base):
    __tablename__ = "finish_by_goal"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, ForeignKey("user.id"), nullable=False)
    show_id = Column(Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False)
    target_date = Column(Date, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "show_id", name="uq_finish_by_user_show"),
        Index("ix_finish_by_user_show", "user_id", "show_id"),
    )
