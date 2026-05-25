from typing import Literal
from fastapi import APIRouter, Depends, BackgroundTasks, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.recommendation_service import (
    send_recommendation,
    get_inbox,
    mark_read,
    get_unread_count,
    delete_recommendation,
)
from app.services.email_service import send_recommendation_email
from app.services.nav_counts import notify_counts_changed
from app.services.for_you_service import get_for_you_recommendations
from app.services.push_service import push_notification
from app.models.user import User
from app.core.limiter import limiter
from app.schemas.common import (
    ContentType,
    RECOMMENDATION_MSG_MAX_LEN,
    RECOMMENDATION_TITLE_MAX_LEN,
    USERNAME_MAX_LEN,
    USERNAME_MIN_LEN,
    USERNAME_PATTERN,
)

router = APIRouter()

ForYouMode = Literal["recent", "top_rated"]


class RecommendationSend(BaseModel):
    recipient_username: str = Field(
        ..., min_length=USERNAME_MIN_LEN, max_length=USERNAME_MAX_LEN, pattern=USERNAME_PATTERN
    )
    content_type: ContentType
    content_id: int = Field(..., ge=1)
    content_title: str = Field(..., min_length=1, max_length=RECOMMENDATION_TITLE_MAX_LEN)
    content_poster_path: str | None = Field(None, max_length=500)
    message: str | None = Field(None, max_length=RECOMMENDATION_MSG_MAX_LEN)


@router.get("/for-you")
def for_you(
    mode: ForYouMode = Query("recent"),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_for_you_recommendations(db, uid, mode)


@router.post("/send")
@limiter.limit("10/minute")
def send(
    request: Request,
    background_tasks: BackgroundTasks,
    body: RecommendationSend,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = send_recommendation(
        db,
        uid,
        body.recipient_username,
        body.content_type,
        body.content_id,
        body.content_title,
        body.content_poster_path,
        body.message,
    )
    notify_counts_changed(db, result.recipient_id)
    if result._email_params:
        background_tasks.add_task(send_recommendation_email, **result._email_params)

    sender = db.query(User).filter_by(id=uid).first()
    sender_name = (sender.username if sender else None) or "Someone"
    title = body.content_title or "something"
    try:
        push_notification(
            db,
            result.recipient_id,
            type="friend_rec",
            title=f"{sender_name} recommended {title}",
            body=body.message or f"Check out this {body.content_type}",
            content_type=body.content_type,
            content_id=body.content_id,
        )
    except Exception:
        # Email + inbox are the source of truth; never let push wreck the response.
        pass
    return result


@router.get("/inbox")
def inbox(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_inbox(db, uid)


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return {"count": get_unread_count(db, uid)}


@router.patch("/{recommendation_id}/read")
def read(
    recommendation_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = mark_read(db, uid, recommendation_id)
    notify_counts_changed(db, uid)
    return result


@router.delete("/{recommendation_id}")
def delete(
    recommendation_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    delete_recommendation(db, uid, recommendation_id)
    return {"detail": "Deleted."}
