from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.watchlist import Watchlist
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
_LISTS = {
    "Want To Watch": Watchlist,
    "Currently Watching": CurrentlyWatching,
    "Watched": Watched,
}
_REMOVE = {
    "Want To Watch": remove_from_watchlist,
    "Currently Watching": remove_from_currently_watching,
    "Watched": remove_from_watched,
}


def _lists_holding(db: Session, uid: str, content_type: str, content_id: int) -> set[str]:
    return {
        name
        for name, model in _LISTS.items()
        if db.query(model.id)
        .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
        .first()
    }


@router.post("/set")
def set_watch_status(
    background_tasks: BackgroundTasks,
    content_type: str = Body(...),
    content_id: int = Body(..., ge=1),
    target: str = Body(...),
    # Still accepted from older clients but ignored: it can be stale (another
    # tab, auto-complete, nightly reactivation), so the server looks it up.
    current: str = Body("none"),
    notify: bool = Body(True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(400, "content_type must be 'movie' or 'tv'")
    if target not in _VALID:
        raise HTTPException(400, f"target must be one of {_VALID}")

    on_lists = _lists_holding(db, uid, content_type, content_id)

    # Only gate new additions — moving between lists doesn't change total count.
    if not on_lists and target not in ("none", "Watched"):
        assert_can_track(db, uid)

    # Add to the target before leaving the old list(s): the remove helpers
    # only clear a show's episode history once it's on no list at all.
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

    # Every other list it's on — normally one, more if it was inconsistent.
    for name in sorted(on_lists - {target}):
        _REMOVE[name](db, uid, content_type, content_id)

    return {"status": target}
