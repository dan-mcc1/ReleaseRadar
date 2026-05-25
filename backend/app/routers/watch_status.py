from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.watchlist_service import add_to_watchlist, remove_from_watchlist, assert_can_track
from app.services.watched_service import (
    add_to_watched,
    remove_from_watched,
    mark_existing_episodes_watched,
    sync_watched_episodes_bg,
)
from app.services.currently_watching_service import (
    add_to_currently_watching,
    remove_from_currently_watching,
)
from app.services.media_upsert import populate_show_bg, populate_movie_bg
from app.services.streaming_notification_service import ensure_providers_populated_bg
from app.services.trailer_notification_service import ensure_trailers_populated_bg

router = APIRouter()

_VALID = {"none", "Want To Watch", "Currently Watching", "Watched"}


@router.post("/set")
def set_watch_status(
    background_tasks: BackgroundTasks,
    content_type: str = Body(...),
    content_id: int = Body(...),
    target: str = Body(...),
    current: str = Body("none"),
    notify: bool = Body(True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(400, "content_type must be 'movie' or 'tv'")
    if target not in _VALID or current not in _VALID:
        raise HTTPException(400, f"target and current must be one of {_VALID}")

    # Only gate new additions — moving between lists doesn't change total count.
    if current == "none" and target not in ("none", "Watched"):
        assert_can_track(db, uid)

    # Add to target first so tracking_count logic correctly sees old-list membership.
    if target == "Want To Watch":
        add_to_watchlist(db, uid, content_type, content_id, notify)
        if content_type == "tv":
            background_tasks.add_task(populate_show_bg, content_id)
        else:
            background_tasks.add_task(populate_movie_bg, content_id)
        background_tasks.add_task(ensure_providers_populated_bg, content_id, content_type)
        background_tasks.add_task(ensure_trailers_populated_bg, content_id, content_type)
    elif target == "Currently Watching":
        add_to_currently_watching(db, uid, content_type, content_id)
        if content_type == "tv":
            background_tasks.add_task(populate_show_bg, content_id)
        else:
            background_tasks.add_task(populate_movie_bg, content_id)
        background_tasks.add_task(ensure_providers_populated_bg, content_id, content_type)
        background_tasks.add_task(ensure_trailers_populated_bg, content_id, content_type)
    elif target == "Watched":
        add_to_watched(db, uid, content_type, content_id)
        if content_type == "tv":
            background_tasks.add_task(populate_show_bg, content_id)
            mark_existing_episodes_watched(db, uid, content_id)
            background_tasks.add_task(sync_watched_episodes_bg, uid, content_id)
        else:
            background_tasks.add_task(populate_movie_bg, content_id)

    # Remove from old list after the add so tracking_count never hits zero mid-swap.
    if current == "Want To Watch":
        remove_from_watchlist(db, uid, content_type, content_id)
    elif current == "Currently Watching":
        remove_from_currently_watching(db, uid, content_type, content_id)
    elif current == "Watched":
        remove_from_watched(db, uid, content_type, content_id)

    return {"status": target}
