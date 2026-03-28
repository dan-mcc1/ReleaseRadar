from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.recommendation_service import (
    send_recommendation,
    get_inbox,
    mark_read,
    get_unread_count,
)

router = APIRouter()


@router.post("/send")
def send(
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
        raise HTTPException(status_code=400, detail="content_type must be 'movie' or 'tv'")
    return send_recommendation(
        db, uid, recipient_username, content_type, content_id,
        content_title, content_poster_path, message,
    )


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
    return mark_read(db, uid, recommendation_id)
