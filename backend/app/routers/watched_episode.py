# app/routers/episode_watched.py
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.watched_episode_service import (
    add_episode_watched,
    remove_episode_watched,
    get_watched_episodes_by_show,
    get_next_unwatched_episode,
    get_next_unwatched_episodes_bulk,
    add_season_watched,
    add_episodes_through,
    get_unwatched_gaps,
    EpisodeNotAiredError,
    remove_season_watched,
)
from app.dependencies.auth import get_current_user
from app.core.limiter import limiter, track_budget
from app.schemas.common import MAX_ID, MAX_SEASON_EPISODE_NUMBER
from app.models.episode_watched import EpisodeWatched
from app.services.stats_service import invalidate_stats_cache

router = APIRouter()

EPISODE_NOTES_MAX_LEN = 2000


class AnnotateEpisodeBody(BaseModel):
    rating: float | None = Field(None, ge=0.5, le=5.0)
    notes: str | None = Field(None, max_length=EPISODE_NOTES_MAX_LEN)


# Add an episode as watched
@router.post("/add", dependencies=[Depends(track_budget)])
@limiter.limit("60/minute")
def add_episode(
    request: Request,
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    episode_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = add_episode_watched(db, uid, show_id, season_number, episode_number)
    invalidate_stats_cache(uid)
    return result


# Mark an episode and every aired episode before it as watched
@router.post("/through", dependencies=[Depends(track_budget)])
@limiter.limit("30/minute")
def add_through_episode(
    request: Request,
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    episode_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    try:
        result = add_episodes_through(db, uid, show_id, season_number, episode_number)
    except EpisodeNotAiredError:
        raise HTTPException(status_code=400, detail="That episode hasn't aired yet.")
    invalidate_stats_cache(uid)
    return result


# Remove an episode from watched
@router.delete("/remove")
def remove_episode(
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    episode_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    result = remove_episode_watched(db, uid, show_id, season_number, episode_number)
    invalidate_stats_cache(uid)
    return result


# Get all watched episodes for the current user
# Mark all episodes in a season as watched
@router.post("/season/add", dependencies=[Depends(track_budget)])
@limiter.limit("30/minute")
def add_season(
    request: Request,
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return add_season_watched(db, uid, show_id, season_number)


# Remove all episodes in a season from watched
@router.delete("/season/remove")
def remove_season(
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return remove_season_watched(db, uid, show_id, season_number)


# Get next unwatched episode for multiple shows in one request
@router.get("/next/bulk")
def get_next_episodes_bulk(
    show_ids: str = Query(..., min_length=1, max_length=2000),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Comma-separated show_ids, e.g. ?show_ids=1,2,3"""
    ids = [int(x) for x in show_ids.split(",") if x.strip().isdigit()][:200]
    return get_next_unwatched_episodes_bulk(db, uid, ids)


# Get watched episodes for the current user for a specific show
@router.get("/{show_id}")
def get_watched_episodes_for_show(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watched_episodes_by_show(db, uid, show_id)


# First aired, unwatched episode of each season (for "Mark watched up to here")
@router.get("/{show_id}/gaps")
def get_episode_gaps(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_unwatched_gaps(db, uid, show_id)


# Get the next unwatched episode for a show
@router.get("/{show_id}/next")
def get_next_episode(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_next_unwatched_episode(db, uid, show_id)


# Update rating and/or notes for a watched episode
@router.patch("/annotate")
def annotate_episode(
    body: AnnotateEpisodeBody,
    show_id: int = Query(..., ge=1, le=MAX_ID),
    season_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    episode_number: int = Query(..., ge=0, le=MAX_SEASON_EPISODE_NUMBER),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    row = (
        db.query(EpisodeWatched)
        .filter_by(
            user_id=uid,
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Episode not marked as watched.")
    if body.rating is not None:
        row.rating = body.rating
    if body.notes is not None:
        row.notes = body.notes.strip() or None
    db.commit()
    db.refresh(row)
    return row
