from sqlalchemy import Column, String, Integer, ForeignKey, UniqueConstraint
from app.db.base import Base


class UserStreamingService(Base):
    __tablename__ = "user_streaming_service"

    user_id = Column(String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    provider_id = Column(Integer, ForeignKey("provider.id", ondelete="CASCADE"), primary_key=True)

    __table_args__ = (
        UniqueConstraint("user_id", "provider_id", name="uq_user_provider"),
    )
