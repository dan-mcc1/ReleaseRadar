from fastapi import APIRouter, BackgroundTasks, Depends, Request
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.schemas.common import ContentRef
from app.services import currently_watching_service, activity_service
from app.services.currently_watching_service import _get_currently_watching_items
from app.services.watchlist_service import _get_item_title_and_poster, assert_can_track
from app.services.episode_service import sync_show_episodes_background
from app.core.limiter import limiter

router = APIRouter()


@router.get("")
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
    return _get_currently_watching_items(db, uid, "tv")


@router.get("/movie")
def get_currently_watching_movie(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return _get_currently_watching_items(db, uid, "movie")


@router.post("/add")
@limiter.limit("10/minute")
def add_currently_watching(
    request: Request,
    background_tasks: BackgroundTasks,
    body: ContentRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    content_type = body.content_type
    content_id = body.content_id
    assert_can_track(db, uid)
    entry = currently_watching_service.add_to_currently_watching(
        db, uid, content_type, content_id
    )
    if content_type == "tv":
        background_tasks.add_task(sync_show_episodes_background, content_id)
    title, poster = _get_item_title_and_poster(db, content_type, content_id)
    activity_service.log_activity(
        db, uid, "currently_watching", content_type, content_id, title, poster
    )
    db.commit()
    return entry


@router.delete("/remove")
def remove_currently_watching(
    body: ContentRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return currently_watching_service.remove_from_currently_watching(
        db, uid, body.content_type, body.content_id
    )
