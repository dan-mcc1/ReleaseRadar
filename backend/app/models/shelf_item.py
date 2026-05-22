from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.base import Base


class ShelfItem(Base):
    __tablename__ = "shelf_items"

    id = Column(Integer, primary_key=True)
    shelf_id = Column(Integer, ForeignKey("shelves.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("user.id"), nullable=False, index=True)
    content_type = Column(String, nullable=False)  # 'movie' | 'tv'
    content_id = Column(Integer, nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now())
    shelf = relationship("Shelf", back_populates="items")

    __table_args__ = (
        UniqueConstraint("shelf_id", "content_type", "content_id"),
        Index("ix_shelf_item_user_content", "user_id", "content_type", "content_id"),
    )
