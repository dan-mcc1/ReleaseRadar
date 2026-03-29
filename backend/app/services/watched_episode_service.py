# app/services/episode_watched_service.py
from sqlalchemy.orm import Session
from datetime import datetime
from app.models.episode_watched import EpisodeWatched
from app.models.episode import Episode
from app.services.episode_service import (
    get_or_create_episode,
    sync_season_episodes,
    ensure_show_in_db,
)


def add_episode_watched(
    db: Session,
    user_id: str,
    show_id: int,
    season_number: int,
    episode_number: int,
    rating: float = None,
):
    """
    Mark an episode as watched.
    Ensures the episode row exists in the episode table (fetching from TMDB
    if needed) and links episode_watched to it via episode_id.
    """
    existing = (
        db.query(EpisodeWatched)
        .filter_by(
            user_id=user_id,
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if existing:
        return existing

    # Ensure the show and episode rows exist (satisfies FK constraints)
    ensure_show_in_db(db, show_id)
    episode = get_or_create_episode(db, show_id, season_number, episode_number)

    entry = EpisodeWatched(
        user_id=user_id,
        show_id=show_id,
        episode_id=episode.id if episode else None,
        season_number=season_number,
        episode_number=episode_number,
        watched_at=datetime.utcnow(),
        rating=rating,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def remove_episode_watched(
    db: Session,
    user_id: str,
    show_id: int,
    season_number: int,
    episode_number: int,
):
    """
    Remove an episode from watched list.
    """
    entry = (
        db.query(EpisodeWatched)
        .filter_by(
            user_id=user_id,
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if entry:
        db.delete(entry)
        db.commit()
        return {"message": "Removed from watched episodes"}
    return {"message": "Episode not found in watched list"}


def get_watched_episodes(db: Session, user_id: str):
    """
    Get all watched episodes for a user.
    """
    items = db.query(EpisodeWatched).filter_by(user_id=user_id).all()
    return [
        {
            "show_id": item.show_id,
            "season_number": item.season_number,
            "episode_number": item.episode_number,
            "watched_at": item.watched_at.isoformat(),
            "rating": item.rating,
        }
        for item in items
    ]


def add_season_watched(db: Session, user_id: str, show_id: int, season_number: int):
    """
    Mark every episode in a season as watched (idempotent).
    Always syncs from TMDB first so that episodes watched individually before
    this call don't leave gaps in the episode table.
    """
    # Always sync — idempotent, skips rows that already exist.
    # This ensures we have the full episode list even if only some episodes
    # were previously watched (and therefore only partially in the episode table).
    sync_season_episodes(db, show_id, season_number)

    episodes = (
        db.query(Episode).filter_by(show_id=show_id, season_number=season_number).all()
    )
    for ep in episodes:
        exists = (
            db.query(EpisodeWatched)
            .filter_by(
                user_id=user_id,
                show_id=show_id,
                season_number=season_number,
                episode_number=ep.episode_number,
            )
            .first()
        )
        if not exists:
            db.add(
                EpisodeWatched(
                    user_id=user_id,
                    show_id=show_id,
                    episode_id=ep.id,
                    season_number=season_number,
                    episode_number=ep.episode_number,
                    watched_at=datetime.utcnow(),
                )
            )
    db.commit()
    return {"message": f"Season {season_number} marked as watched"}


def remove_season_watched(db: Session, user_id: str, show_id: int, season_number: int):
    """
    Remove all episode_watched entries for a season.
    """
    db.query(EpisodeWatched).filter_by(
        user_id=user_id,
        show_id=show_id,
        season_number=season_number,
    ).delete()
    db.commit()
    return {"message": f"Season {season_number} removed from watched"}


def get_next_unwatched_episode(db: Session, user_id: str, show_id: int) -> dict:
    """
    Return the next episode the user hasn't watched for a given show.
    Returns {"finished": True} if all known episodes are watched.
    Syncs the next un-synced season from TMDb if needed.
    """
    from app.models.show import Show
    from app.services.episode_service import sync_season_episodes

    watched_set = {
        (w.season_number, w.episode_number)
        for w in db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=show_id).all()
    }

    def _query_episodes():
        return (
            db.query(Episode)
            .filter(Episode.show_id == show_id, Episode.season_number > 0)
            .order_by(Episode.season_number, Episode.episode_number)
            .all()
        )

    episodes = _query_episodes()

    # If we have no episode data at all, sync season 1 first
    if not episodes:
        sync_season_episodes(db, show_id, 1)
        episodes = _query_episodes()

    # Find first unwatched episode
    for ep in episodes:
        if (ep.season_number, ep.episode_number) not in watched_set:
            return {
                "finished": False,
                "season_number": ep.season_number,
                "episode_number": ep.episode_number,
                "name": ep.name,
                "still_path": ep.still_path,
                "overview": ep.overview,
                "air_date": str(ep.air_date) if ep.air_date else None,
            }

    # All synced episodes watched — check if there are more seasons to sync
    show = db.query(Show).filter_by(id=show_id).first()
    max_synced = max((ep.season_number for ep in episodes), default=0)
    total_seasons = show.number_of_seasons if show else None

    if total_seasons and max_synced < total_seasons:
        sync_season_episodes(db, show_id, max_synced + 1)
        new_episodes = (
            db.query(Episode)
            .filter(Episode.show_id == show_id, Episode.season_number == max_synced + 1)
            .order_by(Episode.episode_number)
            .all()
        )
        for ep in new_episodes:
            if (ep.season_number, ep.episode_number) not in watched_set:
                return {
                    "finished": False,
                    "season_number": ep.season_number,
                    "episode_number": ep.episode_number,
                    "name": ep.name,
                    "still_path": ep.still_path,
                    "overview": ep.overview,
                    "air_date": str(ep.air_date) if ep.air_date else None,
                }

    return {"finished": True}


def get_watched_episodes_by_show(db: Session, user_id: str, show_id: int):
    """
    Get all watched episodes for a user for a specific show.
    """
    items = db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=show_id).all()
    return [
        {
            "season_number": item.season_number,
            "episode_number": item.episode_number,
            "watched_at": item.watched_at.isoformat(),
            "rating": item.rating,
        }
        for item in items
    ]
