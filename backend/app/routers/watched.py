from fastapi import APIRouter, Depends, Body, BackgroundTasks, HTTPException, Request
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.watched_service import (
    add_to_watched,
    mark_existing_episodes_watched,
    sync_watched_episodes_bg,
    get_watched,
    remove_from_watched,
    _get_watched_items,
    update_watched_rating,
)
from app.dependencies.auth import get_current_user
from app.core.limiter import limiter

router = APIRouter()


@router.post("/add")
@limiter.limit("30/minute")
def add_item(
    request: Request,
    background_tasks: BackgroundTasks,
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )
    result = add_to_watched(db, uid, content_type, content_id)
    if content_type == "tv":
        mark_existing_episodes_watched(db, uid, content_id)
        background_tasks.add_task(sync_watched_episodes_bg, uid, content_id)
    return result


@router.patch("/rate")
def rate_item(
    content_type: str = Body(...),
    content_id: int = Body(...),
    rating: float = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = update_watched_rating(db, uid, content_type, content_id, rating)
    if result is None:
        raise HTTPException(status_code=404, detail="Item not in watched list")
    return result


@router.delete("/remove")
def remove_item(
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )
    return remove_from_watched(db, uid, content_type, content_id)


@router.get("")
def get_user_watched(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watched(db, uid)


@router.get("/tv")
def watched_tv_info(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return _get_watched_items(db, uid, "tv")


@router.get("/movie")
def watched_movie_info(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return _get_watched_items(db, uid, "movie")
