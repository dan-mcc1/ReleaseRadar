"""Households: a small private circle (a couple, a family) that shares a
"Watch together" list, sees each other's progress on shared shows, and can
log a watch for everyone who was in the room."""
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base import Base


class Household(Base):
    __tablename__ = "household"

    id = Column(Integer, primary_key=True)
    name = Column(String(60), nullable=False)
    created_by = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class HouseholdMember(Base):
    __tablename__ = "household_member"

    household_id = Column(
        Integer, ForeignKey("household.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role = Column(String, nullable=False, server_default="member")  # 'owner' | 'member'
    joined_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class HouseholdInvite(Base):
    """An invite to a friend. One row per household and invitee: re-inviting
    after a decline sets it back to pending."""
    __tablename__ = "household_invite"

    id = Column(Integer, primary_key=True)
    household_id = Column(
        Integer, ForeignKey("household.id", ondelete="CASCADE"), nullable=False
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invited_by = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    status = Column(String, nullable=False, server_default="pending")  # pending | declined
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("household_id", "user_id", name="uq_household_invite"),
    )


class HouseholdItem(Base):
    """A title on a household's shared Watch together list."""
    __tablename__ = "household_item"

    id = Column(Integer, primary_key=True)
    household_id = Column(
        Integer, ForeignKey("household.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_type = Column(String, nullable=False)  # 'movie' | 'tv'
    content_id = Column(Integer, nullable=False)
    added_by = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("household_id", "content_type", "content_id", name="uq_household_item"),
    )
