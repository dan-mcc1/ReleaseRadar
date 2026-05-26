from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func
from app.db.base import Base


class SeasonRating(Base):
    __tablename__ = "season_rating"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    show_id = Column(
        Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False
    )
    season_number = Column(Integer, nullable=False)
    rating = Column(Float, nullable=False)
    rated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "show_id", "season_number", name="uq_season_rating_user_season"
        ),
        Index("ix_season_rating_show_season", "show_id", "season_number"),
    )
