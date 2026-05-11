from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.db.base import Base


class BannedEmail(Base):
    __tablename__ = "banned_email"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, unique=True, nullable=False, index=True)
    user_id = Column(String, index=True, nullable=True)
    banned_at = Column(DateTime(timezone=True), server_default=func.now())
