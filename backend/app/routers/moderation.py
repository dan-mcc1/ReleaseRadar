from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.block import Block
from app.models.report import Report
from app.models.user import User
from app.models.review import Review
from app.models.community import Community, CommunityPost, CommunityReply
from app.schemas.common import (
    REPORT_MESSAGE_MAX_LEN,
    ReportReason,
    ReportTargetType,
)

router = APIRouter()


class ReportBody(BaseModel):
    reported_type: ReportTargetType
    reported_id: str = Field(..., min_length=1, max_length=128)
    reason: ReportReason
    message: str | None = Field(None, max_length=REPORT_MESSAGE_MAX_LEN)


# ── Block endpoints ────────────────────────────────────────────────────────────

@router.post("/block/{user_id}")
@limiter.limit("20/minute")
def block_user(
    request: Request,
    user_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if user_id == uid:
        raise HTTPException(status_code=400, detail="You cannot block yourself.")

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    existing = (
        db.query(Block)
        .filter(Block.blocker_id == uid, Block.blocked_id == user_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="You have already blocked this user.")

    db.add(Block(blocker_id=uid, blocked_id=user_id))
    db.commit()
    return {"detail": "User blocked."}


@router.delete("/block/{user_id}")
def unblock_user(
    user_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    block = (
        db.query(Block)
        .filter(Block.blocker_id == uid, Block.blocked_id == user_id)
        .first()
    )
    if not block:
        raise HTTPException(status_code=404, detail="Block not found.")

    db.delete(block)
    db.commit()
    return {"detail": "User unblocked."}


@router.get("/blocks")
def get_my_blocks(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    blocks = db.query(Block).filter(Block.blocker_id == uid).all()
    blocked_ids = [b.blocked_id for b in blocks]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(blocked_ids)).all()
    }
    return [
        {
            "user_id": b.blocked_id,
            "username": users[b.blocked_id].username if b.blocked_id in users else None,
            "blocked_at": b.created_at,
        }
        for b in blocks
    ]


# ── Report endpoints ───────────────────────────────────────────────────────────

@router.post("/report")
@limiter.limit("10/minute")
def submit_report(
    request: Request,
    body: ReportBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    reported_type = body.reported_type
    reported_id = body.reported_id
    reason = body.reason
    message = body.message

    review_snapshot_kwargs = {}

    if reported_type == "review":
        try:
            review_id = int(reported_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid review ID.")
        review = db.query(Review).filter(Review.id == review_id).first()
        if not review:
            raise HTTPException(status_code=404, detail="Review not found.")
        if review.user_id == uid:
            raise HTTPException(status_code=400, detail="You cannot report your own review.")
        author = db.query(User).filter(User.id == review.user_id).first()
        review_snapshot_kwargs = {
            "snapshot_author_id": review.user_id,
            "snapshot_author_username": author.username if author else review.user_id,
            "snapshot_content_type": review.content_type,
            "snapshot_content_id": review.content_id,
            "snapshot_review_text": review.review_text,
            "snapshot_review_created_at": review.created_at,
        }

    user_snapshot_kwargs = {}

    if reported_type == "user":
        if reported_id == uid:
            raise HTTPException(status_code=400, detail="You cannot report yourself.")
        target = db.query(User).filter(User.id == reported_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")
        user_snapshot_kwargs = {
            "snapshot_user_username": target.username,
            "snapshot_user_email": target.email,
            "snapshot_user_created_at": target.created_at,
        }

    if reported_type == "community":
        try:
            cid = int(reported_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid group ID.")
        if not db.query(Community.id).filter(Community.id == cid).first():
            raise HTTPException(status_code=404, detail="Group not found.")

    if reported_type == "community_post":
        try:
            pid = int(reported_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid post ID.")
        post = db.query(CommunityPost).filter(CommunityPost.id == pid).first()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found.")
        if post.user_id == uid:
            raise HTTPException(
                status_code=400, detail="You cannot report your own post."
            )

    if reported_type == "community_reply":
        try:
            rid = int(reported_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid reply ID.")
        reply = db.query(CommunityReply).filter(CommunityReply.id == rid).first()
        if not reply:
            raise HTTPException(status_code=404, detail="Reply not found.")
        if reply.user_id == uid:
            raise HTTPException(
                status_code=400, detail="You cannot report your own reply."
            )

    # Prevent duplicate pending reports from the same reporter
    existing = (
        db.query(Report)
        .filter(
            Report.reporter_id == uid,
            Report.reported_type == reported_type,
            Report.reported_id == reported_id,
            Report.status == "pending",
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="You have already reported this. It is pending review."
        )

    db.add(
        Report(
            reporter_id=uid,
            reported_type=reported_type,
            reported_id=reported_id,
            reason=reason,
            message=message or None,
            **review_snapshot_kwargs,
            **user_snapshot_kwargs,
        )
    )
    db.commit()
    return {"detail": "Report submitted. Thank you."}
