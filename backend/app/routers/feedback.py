from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import require_admin
from app.models.feedback import Feedback
from app.models.user import User
from app.schemas.common import (
    FEEDBACK_ADMIN_NOTES_MAX_LEN,
    FEEDBACK_DESC_MAX_LEN,
    FEEDBACK_SUBJECT_MAX_LEN,
    FeedbackCategory,
    FeedbackStatus,
)

router = APIRouter()


class FeedbackCreate(BaseModel):
    category: FeedbackCategory
    subject: str = Field(..., min_length=1, max_length=FEEDBACK_SUBJECT_MAX_LEN)
    description: str = Field(..., min_length=1, max_length=FEEDBACK_DESC_MAX_LEN)


class FeedbackStatusUpdate(BaseModel):
    status: FeedbackStatus
    admin_notes: str | None = Field(None, max_length=FEEDBACK_ADMIN_NOTES_MAX_LEN)


@router.post("/feedback")
@limiter.limit("5/minute")
def submit_feedback(
    request: Request,
    body: FeedbackCreate,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    entry = Feedback(
        user_id=uid,
        category=body.category,
        subject=body.subject.strip(),
        description=body.description.strip(),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "status": entry.status}


@router.get("/feedback")
def list_feedback(
    category: FeedbackCategory | None = Query(None),
    status: FeedbackStatus | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    uid: str = Depends(require_admin),
):
    q = db.query(Feedback)
    if category:
        q = q.filter(Feedback.category == category)
    if status:
        q = q.filter(Feedback.status == status)
    total = q.count()
    items = q.order_by(Feedback.created_at.desc()).offset(offset).limit(limit).all()

    # Fetch usernames for display
    user_ids = [i.user_id for i in items if i.user_id]
    users = {u.id: u.username for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    return {
        "total": total,
        "items": [
            {
                "id": i.id,
                "category": i.category,
                "subject": i.subject,
                "description": i.description,
                "status": i.status,
                "admin_notes": i.admin_notes,
                "created_at": i.created_at.isoformat() if i.created_at else None,
                "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None,
                "username": users.get(i.user_id) if i.user_id else None,
            }
            for i in items
        ],
    }


@router.patch("/feedback/{feedback_id}")
def update_feedback(
    feedback_id: int,
    body: FeedbackStatusUpdate,
    db: Session = Depends(get_db),
    uid: str = Depends(require_admin),
):
    entry = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Feedback not found.")

    entry.status = body.status
    if body.admin_notes is not None:
        entry.admin_notes = body.admin_notes
    if body.status == "closed" and not entry.resolved_at:
        entry.resolved_at = datetime.now(timezone.utc)
    elif body.status != "closed":
        entry.resolved_at = None

    db.commit()
    return {"id": entry.id, "status": entry.status}
