from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
    Boolean,
)
from sqlalchemy.sql import func
from app.db.base import Base


class Community(Base):
    """A user-created group/community focused on a theme (e.g. anime, rom-com)."""

    __tablename__ = "community"

    id = Column(Integer, primary_key=True)
    slug = Column(String(60), unique=True, nullable=False, index=True)
    name = Column(String(80), nullable=False)
    description = Column(Text, nullable=True)
    banner_color = Column(String(20), nullable=True)
    visibility = Column(
        String, nullable=False, server_default="public"
    )
    is_featured = Column(Boolean, nullable=False, server_default="false")
    # When False (default), only owner/admin can add or remove titles.
    # When True, any member can.
    members_can_edit_media = Column(
        Boolean, nullable=False, server_default="false"
    )
    member_count = Column(Integer, nullable=False, server_default="0")
    created_by = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CommunityMember(Base):
    __tablename__ = "community_member"

    community_id = Column(
        Integer, ForeignKey("community.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    role = Column(String, nullable=False, server_default="member")
    joined_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_community_member_user", "user_id"),
    )


class CommunityMedia(Base):
    """A movie/show attached to a community."""

    __tablename__ = "community_media"

    id = Column(Integer, primary_key=True)
    community_id = Column(
        Integer, ForeignKey("community.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content_type = Column(String, nullable=False)
    content_id = Column(Integer, nullable=False)
    added_by = Column(String, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "community_id", "content_type", "content_id", name="uq_community_media"
        ),
    )


class CommunityPost(Base):
    __tablename__ = "community_post"

    id = Column(Integer, primary_key=True)
    community_id = Column(
        Integer, ForeignKey("community.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    title = Column(String(150), nullable=True)
    body = Column(Text, nullable=False)
    reply_count = Column(Integer, nullable=False, server_default="0")
    like_count = Column(Integer, nullable=False, server_default="0")
    edited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


class CommunityReply(Base):
    __tablename__ = "community_reply"

    id = Column(Integer, primary_key=True)
    post_id = Column(
        Integer, ForeignKey("community_post.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    body = Column(Text, nullable=False)
    like_count = Column(Integer, nullable=False, server_default="0")
    edited_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CommunityPostLike(Base):
    __tablename__ = "community_post_like"

    post_id = Column(
        Integer, ForeignKey("community_post.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_community_post_like_user", "user_id"),)


class CommunityReplyLike(Base):
    __tablename__ = "community_reply_like"

    reply_id = Column(
        Integer, ForeignKey("community_reply.id", ondelete="CASCADE"), primary_key=True
    )
    user_id = Column(
        String, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_community_reply_like_user", "user_id"),)
