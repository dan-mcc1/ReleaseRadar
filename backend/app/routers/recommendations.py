from fastapi import APIRouter, Depends, Body, HTTPException, BackgroundTasks, Request
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
from app.core.event_bus import publish
from app.models.friendship import Friendship
from app.services.for_you_service import get_for_you_recommendations
from app.core.limiter import limiter

router = APIRouter()


@router.get("/for-you")
def for_you(
    mode: str = "recent",
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if mode not in ("recent", "top_rated"):
        mode = "recent"
    return get_for_you_recommendations(db, uid, mode)


@router.post("/send")
@limiter.limit("10/minute")
def send(
    request: Request,
    background_tasks: BackgroundTasks,
    recipient_username: str = Body(...),
    content_type: str = Body(...),
    content_id: int = Body(...),
    content_title: str = Body(...),
    content_poster_path: str | None = Body(None),
    message: str | None = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )
    result = send_recommendation(
        db,
        uid,
        recipient_username,
        content_type,
        content_id,
        content_title,
        content_poster_path,
        message,
    )
    pending_count = (
        db.query(Friendship)
        .filter(Friendship.addressee_id == result.recipient_id, Friendship.status == "pending")
        .count()
    )
    unread_count = get_unread_count(db, result.recipient_id)
    publish(result.recipient_id, {
        "type": "counts_update",
        "pending_requests": pending_count,
        "unread_recs": unread_count,
    })
    if result._email_params:
        background_tasks.add_task(send_recommendation_email, **result._email_params)
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
    pending_count = (
        db.query(Friendship)
        .filter(Friendship.addressee_id == uid, Friendship.status == "pending")
        .count()
    )
    unread_count = get_unread_count(db, uid)
    publish(uid, {
        "type": "counts_update",
        "pending_requests": pending_count,
        "unread_recs": unread_count,
    })
    return result


@router.delete("/{recommendation_id}")
def delete(
    recommendation_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    delete_recommendation(db, uid, recommendation_id)
    return {"detail": "Deleted."}
