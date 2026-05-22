from sqlalchemy import Boolean, Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.base import Base


class Shelf(Base):
    __tablename__ = "shelves"

    id = Column(Integer, primary_key=True)
    user_id = Column(String, ForeignKey("user.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    notify = Column(Boolean, default=True, server_default="true", nullable=False)
    items = relationship("ShelfItem", back_populates="shelf", cascade="all, delete-orphan")
