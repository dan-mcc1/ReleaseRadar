from fastapi import APIRouter, Depends, Body, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.movie import Movie
from app.models.show import Show
from app.services.email_service import send_notification_email, format_air_time
from datetime import date, timedelta

router = APIRouter()


@router.patch("/preferences")
def update_notification_preferences(
    email_notifications: bool = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.email_notifications = email_notifications
    db.commit()
    return {"email_notifications": user.email_notifications}


@router.get("/preferences")
def get_notification_preferences(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"email_notifications": user.email_notifications}


def _build_upcoming_items(db: Session, user_id: str) -> list:
    """Find watchlisted movies/shows releasing in the next 7 days."""
    today = date.today()
    next_week = today + timedelta(days=7)
    upcoming = []

    movie_ids = [
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter_by(user_id=user_id, content_type="movie")
        .all()
    ]
    for mid in movie_ids:
        m = db.query(Movie).filter_by(id=mid).first()
        if m and m.release_date:
            try:
                rd = date.fromisoformat(str(m.release_date))
                if today <= rd <= next_week:
                    upcoming.append({"title": m.title, "date": str(rd)})
            except (ValueError, TypeError):
                pass

    show_ids = [
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter_by(user_id=user_id, content_type="tv")
        .all()
    ]
    for sid in show_ids:
        s = db.query(Show).filter_by(id=sid).first()
        if s and s.last_air_date:
            try:
                lad = date.fromisoformat(str(s.last_air_date))
                if today <= lad <= next_week:
                    upcoming.append({
                        "title": s.name,
                        "date": str(lad),
                        "air_time": format_air_time(s.air_time, s.air_timezone),
                    })
            except (ValueError, TypeError):
                pass

    return upcoming


def _build_todays_items(db: Session, user_id: str) -> list:
    """Find watchlisted movies/shows releasing today."""
    today = date.today()
    upcoming = []

    movie_ids = [
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter_by(user_id=user_id, content_type="movie")
        .all()
    ]
    for mid in movie_ids:
        m = db.query(Movie).filter_by(id=mid).first()
        if m and m.release_date:
            try:
                if date.fromisoformat(str(m.release_date)) == today:
                    upcoming.append({"title": m.title, "date": str(today)})
            except (ValueError, TypeError):
                pass

    show_ids = [
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter_by(user_id=user_id, content_type="tv")
        .all()
    ]
    for sid in show_ids:
        s = db.query(Show).filter_by(id=sid).first()
        if s and s.last_air_date:
            try:
                if date.fromisoformat(str(s.last_air_date)) == today:
                    upcoming.append({
                        "title": s.name,
                        "date": str(today),
                        "air_time": format_air_time(s.air_time, s.air_timezone),
                    })
            except (ValueError, TypeError):
                pass

    return upcoming


def send_daily_digest_to_all(db: Session):
    """Send today's digest email to all users with notifications enabled."""
    users = (
        db.query(User)
        .filter(User.email_notifications == True, User.email != None)
        .all()
    )
    for user in users:
        try:
            items = _build_todays_items(db, user.id)
            if items:
                send_notification_email(user.email, user.username or "", items)
        except Exception as e:
            print(f"[daily digest] Failed for {user.email}: {e}")


@router.post("/send-digest")
def send_digest(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Trigger a digest email for the current user."""
    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email_notifications:
        raise HTTPException(status_code=400, detail="Email notifications are disabled")
    if not user.email:
        raise HTTPException(status_code=400, detail="No email address on file")

    upcoming = _build_upcoming_items(db, uid)

    background_tasks.add_task(
        send_notification_email, user.email, user.username or "", upcoming
    )
    return {"message": "Digest email queued"}
