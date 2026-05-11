from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Body, Request
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.block import Block
from app.models.report import Report
from app.models.user import User
from app.models.review import Review

router = APIRouter()

VALID_REPORT_REASONS = [
    "spam",
    "harassment",
    "hate_speech",
    "inappropriate_content",
    "misinformation",
    "other",
]


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
    reported_type: str = Body(...),
    reported_id: str = Body(...),
    reason: str = Body(...),
    message: str | None = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if reported_type not in ("review", "user"):
        raise HTTPException(
            status_code=400, detail="reported_type must be 'review' or 'user'."
        )
    if reason not in VALID_REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Invalid reason.")

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

    if reported_type == "user":
        if reported_id == uid:
            raise HTTPException(status_code=400, detail="You cannot report yourself.")
        target = db.query(User).filter(User.id == reported_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")

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
        )
    )
    db.commit()
    return {"detail": "Report submitted. Thank you."}
