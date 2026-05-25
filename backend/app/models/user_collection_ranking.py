from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class UserCollectionRanking(Base):
    """Per-user ranking of the movies within a collection."""

    __tablename__ = "user_collection_ranking"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), index=True, nullable=False
    )
    collection_id = Column(
        Integer,
        ForeignKey("collection.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    movie_id = Column(Integer, nullable=False)
    rank = Column(Integer, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id", "collection_id", "movie_id", name="uq_user_collection_movie"
        ),
    )
