# app/routers/rewatch.py
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import and_
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import feature_gate
from app.models.rewatch import Rewatch

router = APIRouter()


@router.post("/add")
def add_rewatch(
    content_type: str = Body(...),
    content_id: int = Body(...),
    rating: float | None = Body(None),
    notes: str | None = Body(None),
    would_rewatch: bool | None = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("rewatch")),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(status_code=422, detail="content_type must be 'movie' or 'tv'.")
    if rating is not None and not (0.5 <= rating <= 5.0):
        raise HTTPException(status_code=422, detail="Rating must be between 0.5 and 5.0.")
    if notes and len(notes) > 2000:
        raise HTTPException(status_code=422, detail="Notes must be 2000 characters or fewer.")

    row = Rewatch(
        user_id=uid,
        content_type=content_type,
        content_id=content_id,
        rating=rating,
        notes=notes.strip() if notes else None,
        would_rewatch=would_rewatch,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/")
def list_rewatches(
    content_type: str | None = None,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    q = db.query(Rewatch).filter_by(user_id=uid)
    if content_type:
        q = q.filter_by(content_type=content_type)
    return q.order_by(Rewatch.watched_at.desc()).all()


@router.get("/{content_type}/{content_id}")
def get_rewatches(
    content_type: str,
    content_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    rows = (
        db.query(Rewatch)
        .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
        .order_by(Rewatch.watched_at.desc())
        .all()
    )
    return {"rewatches": rows, "count": len(rows)}


@router.patch("/{rewatch_id}")
def update_rewatch(
    rewatch_id: int,
    rating: float | None = Body(None),
    notes: str | None = Body(None),
    would_rewatch: bool | None = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("rewatch")),
):
    row = db.query(Rewatch).filter(
        and_(Rewatch.id == rewatch_id, Rewatch.user_id == uid)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Rewatch entry not found.")
    if rating is not None:
        if not (0.5 <= rating <= 5.0):
            raise HTTPException(status_code=422, detail="Rating must be between 0.5 and 5.0.")
        row.rating = rating
    if notes is not None:
        row.notes = notes.strip() or None
    if would_rewatch is not None:
        row.would_rewatch = would_rewatch
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{rewatch_id}")
def delete_rewatch(
    rewatch_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("rewatch")),
):
    row = db.query(Rewatch).filter(
        and_(Rewatch.id == rewatch_id, Rewatch.user_id == uid)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Rewatch entry not found.")
    db.delete(row)
    db.commit()
    return {"deleted": True}
