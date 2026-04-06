from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.models.recommendation import Recommendation
from app.models.user import User
from app.services.friends_service import are_friends

_REC_TTL_DAYS = 7


def send_recommendation(
    db: Session,
    sender_id: str,
    recipient_username: str,
    content_type: str,
    content_id: int,
    content_title: str,
    content_poster_path: str | None,
    message: str | None,
):
    recipient = db.query(User).filter(User.username == recipient_username).first()
    if not recipient:
        raise HTTPException(status_code=404, detail="User not found.")

    if recipient.id == sender_id:
        raise HTTPException(status_code=400, detail="You cannot recommend something to yourself.")

    if not are_friends(db, sender_id, recipient.id):
        raise HTTPException(status_code=403, detail="You can only recommend to friends.")

    entry = Recommendation(
        sender_id=sender_id,
        recipient_id=recipient.id,
        content_type=content_type,
        content_id=content_id,
        content_title=content_title,
        content_poster_path=content_poster_path,
        message=message,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    sender = db.query(User).filter_by(id=sender_id).first()

    # Return email params alongside the entry so the router can fire the email
    # in a background task without blocking the response.
    entry._email_params = None
    if recipient.email and recipient.email_notifications:
        entry._email_params = {
            "to_email": recipient.email,
            "to_username": recipient.username or "",
            "from_username": sender.username or sender.email or "Someone",
            "content_type": content_type,
            "content_title": content_title or "something",
            "content_id": content_id,
            "message": message,
            "uid": recipient.id,
            "poster_path": content_poster_path,
        }

    return entry


def _serialize(rec: Recommendation, sender_username: str) -> dict:
    return {
        "id": rec.id,
        "sender_id": rec.sender_id,
        "sender_username": sender_username,
        "content_type": rec.content_type,
        "content_id": rec.content_id,
        "content_title": rec.content_title,
        "content_poster_path": rec.content_poster_path,
        "message": rec.message,
        "is_read": rec.is_read,
        "created_at": rec.created_at.isoformat() if rec.created_at else None,
    }


def get_inbox(db: Session, user_id: str) -> list:
    cutoff = datetime.now(timezone.utc) - timedelta(days=_REC_TTL_DAYS)
    rows = (
        db.query(Recommendation, User.username)
        .join(User, User.id == Recommendation.sender_id)
        .filter(
            Recommendation.recipient_id == user_id,
            Recommendation.created_at >= cutoff,
        )
        .order_by(Recommendation.created_at.desc())
        .all()
    )
    return [_serialize(rec, username) for rec, username in rows]


def mark_read(db: Session, user_id: str, recommendation_id: int):
    rec = (
        db.query(Recommendation)
        .filter_by(id=recommendation_id, recipient_id=user_id)
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found.")
    rec.is_read = True
    db.commit()
    return {"message": "Marked as read"}


def delete_recommendation(db: Session, user_id: str, recommendation_id: int):
    rec = (
        db.query(Recommendation)
        .filter_by(id=recommendation_id, recipient_id=user_id)
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found.")
    db.delete(rec)
    db.commit()


def delete_old_recommendations(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=_REC_TTL_DAYS)
    deleted = (
        db.query(Recommendation)
        .filter(Recommendation.created_at < cutoff)
        .delete()
    )
    db.commit()
    return deleted


def get_unread_count(db: Session, user_id: str) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=_REC_TTL_DAYS)
    return (
        db.query(Recommendation)
        .filter(
            Recommendation.recipient_id == user_id,
            Recommendation.is_read == False,  # noqa: E712
            Recommendation.created_at >= cutoff,
        )
        .count()
    )
