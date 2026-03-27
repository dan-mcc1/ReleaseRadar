from fastapi import APIRouter, Depends, Body, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import currently_watching_service
from app.services import activity_service
from app.models.movie import Movie
from app.models.show import Show

router = APIRouter()


@router.get("/")
def get_currently_watching(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return currently_watching_service.get_currently_watching(db, uid)


@router.get("/tv")
def get_currently_watching_tv(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return currently_watching_service.get_currently_watching(db, uid)["shows"]


@router.get("/movie")
def get_currently_watching_movie(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return currently_watching_service.get_currently_watching(db, uid)["movies"]


@router.post("/add")
def add_currently_watching(
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(status_code=400, detail="content_type must be 'movie' or 'tv'")
    entry = currently_watching_service.add_to_currently_watching(db, uid, content_type, content_id)

    # Log activity
    if content_type == "movie":
        item = db.query(Movie).filter_by(id=content_id).first()
        title = item.title if item else None
        poster = item.poster_path if item else None
    else:
        item = db.query(Show).filter_by(id=content_id).first()
        title = item.name if item else None
        poster = item.poster_path if item else None

    activity_service.log_activity(
        db, uid, "currently_watching", content_type, content_id, title, poster
    )
    db.commit()

    return entry


@router.delete("/remove")
def remove_currently_watching(
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return currently_watching_service.remove_from_currently_watching(db, uid, content_type, content_id)
