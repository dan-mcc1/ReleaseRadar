from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException, Request
from pydantic import Field
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.schemas.common import ContentRef
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
from app.services.stats_service import invalidate_stats_cache
from app.services.media_upsert import populate_show_bg, populate_movie_bg

router = APIRouter()


class RateWatchedBody(ContentRef):
    rating: float | None = Field(None, ge=0.5, le=5.0)


@router.post("/add")
@limiter.limit("30/minute")
def add_item(
    request: Request,
    background_tasks: BackgroundTasks,
    body: ContentRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    content_type = body.content_type
    content_id = body.content_id
    result = add_to_watched(db, uid, content_type, content_id)
    if content_type == "tv":
        background_tasks.add_task(populate_show_bg, content_id)
        mark_existing_episodes_watched(db, uid, content_id)
        background_tasks.add_task(sync_watched_episodes_bg, uid, content_id)
    else:
        background_tasks.add_task(populate_movie_bg, content_id)
    invalidate_stats_cache(uid)
    return result


@router.patch("/rate")
def rate_item(
    body: RateWatchedBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = update_watched_rating(db, uid, body.content_type, body.content_id, body.rating)
    if result is None:
        raise HTTPException(status_code=404, detail="Item not in watched list")
    invalidate_stats_cache(uid)
    return result


@router.delete("/remove")
def remove_item(
    body: ContentRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = remove_from_watched(db, uid, body.content_type, body.content_id)
    invalidate_stats_cache(uid)
    return result


@router.get("")
def get_user_watched(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watched(db, uid)


@router.get("/tv")
def watched_tv_info(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return _get_watched_items(db, uid, "tv")


@router.get("/movie")
def watched_movie_info(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return _get_watched_items(db, uid, "movie")
