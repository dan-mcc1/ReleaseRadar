# app/routers/episode_watched.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.watched_episode_service import (
    add_episode_watched,
    remove_episode_watched,
    get_watched_episodes,
    get_watched_episodes_by_show,
    get_next_unwatched_episode,
    add_season_watched,
    remove_season_watched,
)
from app.dependencies.auth import get_current_user

router = APIRouter()


# Add an episode as watched
@router.post("/add")
def add_episode(
    show_id: int,
    season_number: int,
    episode_number: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return add_episode_watched(db, uid, show_id, season_number, episode_number)


# Remove an episode from watched
@router.delete("/remove")
def remove_episode(
    show_id: int,
    season_number: int,
    episode_number: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return remove_episode_watched(db, uid, show_id, season_number, episode_number)


# Get all watched episodes for the current user
@router.get("/")
def get_user_watched_episodes(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watched_episodes(db, uid)


# Mark all episodes in a season as watched
@router.post("/season/add")
def add_season(
    show_id: int,
    season_number: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return add_season_watched(db, uid, show_id, season_number)


# Remove all episodes in a season from watched
@router.delete("/season/remove")
def remove_season(
    show_id: int,
    season_number: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return remove_season_watched(db, uid, show_id, season_number)


# Get watched episodes for the current user for a specific show
@router.get("/{show_id}")
def get_watched_episodes_for_show(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watched_episodes_by_show(db, uid, show_id)


# Get the next unwatched episode for a show
@router.get("/{show_id}/next")
def get_next_episode(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_next_unwatched_episode(db, uid, show_id)
