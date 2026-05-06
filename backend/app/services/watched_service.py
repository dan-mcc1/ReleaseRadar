# app/services/watched_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.services.watchlist_service import (
    serialize_show_list,
    serialize_movie_list,
    _show_query_options_list,
    _movie_query_options_list,
    _get_item_title_and_poster,
    _is_tracked_on_any,
    ensure_movie_in_db,
    ensure_show_in_db,
)
from app.services.episode_service import sync_show_episodes
from app.services.activity_service import log_activity
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.db.session import SessionLocal


def _is_on_other_list(db: Session, user_id: str, content_type: str, content_id: int) -> bool:
    """Return True if the item exists on Watchlist or CurrentlyWatching."""
    return _is_tracked_on_any(db, user_id, content_type, content_id, Watchlist, CurrentlyWatching)


def add_to_watched(
    db: Session, user_id: str, content_type: str, content_id: int, rating: float = None
):
    """
    Mark a movie or show as watched.
    """
    existing = (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if existing:
        return existing

    already_tracked = _is_on_other_list(db, user_id, content_type, content_id)

    entry = Watched(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        watched_at=datetime.utcnow(),
        rating=rating,
    )
    db.add(entry)

    if content_type == "movie":
        media = ensure_movie_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "watched", content_type, content_id, media.title, media.poster_path)
    elif content_type == "tv":
        media = ensure_show_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "watched", content_type, content_id, media.name, media.poster_path)
    else:
        log_activity(db, user_id, "watched", content_type, content_id, None, None)

    db.commit()
    db.refresh(entry)
    return entry


def _mark_episodes_watched(db: Session, user_id: str, content_id: int):
    """
    Mark all episodes currently in the DB for this show as watched.
    Called with an existing session (no commit — caller must commit).
    """
    episodes = db.query(Episode).filter_by(show_id=content_id).all()
    existing_keys = {
        (row.season_number, row.episode_number)
        for row in db.query(EpisodeWatched.season_number, EpisodeWatched.episode_number)
        .filter_by(user_id=user_id, show_id=content_id)
        .all()
    }
    new_rows = [
        EpisodeWatched(
            user_id=user_id,
            show_id=content_id,
            episode_id=ep.id,
            season_number=ep.season_number,
            episode_number=ep.episode_number,
            watched_at=datetime.utcnow(),
        )
        for ep in episodes
        if (ep.season_number, ep.episode_number) not in existing_keys
    ]
    if new_rows:
        db.bulk_save_objects(new_rows)


def mark_existing_episodes_watched(db: Session, user_id: str, content_id: int):
    """
    Synchronously mark all episodes as watched and commit.
    If no episodes are in the DB yet, syncs from TMDB first so the client
    sees accurate data immediately rather than waiting for the background task.
    """
    episode_count = db.query(Episode).filter_by(show_id=content_id).count()
    if episode_count == 0:
        sync_show_episodes(db, content_id)
    _mark_episodes_watched(db, user_id, content_id)
    db.commit()


def sync_watched_episodes_bg(user_id: str, content_id: int):
    """
    Background task: sync episodes from TMDB then mark any newly discovered
    ones as watched. Uses its own DB session (runs after the response returns).
    """
    db = SessionLocal()
    try:
        sync_show_episodes(db, content_id)
        _mark_episodes_watched(db, user_id, content_id)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[sync_watched_episodes_bg] Error for show {content_id}: {e}")
    finally:
        db.close()


def update_watched_rating(
    db: Session, user_id: str, content_type: str, content_id: int, rating: float = None
):
    entry = (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not entry:
        return None
    entry.rating = rating

    if rating is not None:
        title, poster = _get_item_title_and_poster(db, content_type, content_id)
        log_activity(db, user_id, "rated", content_type, content_id, title, poster, rating=rating)

    db.commit()
    db.refresh(entry)
    return entry


def remove_from_watched(db: Session, user_id: str, content_type: str, content_id: int):
    """
    Remove a movie or show from the watched list.
    For TV shows, also clears all episode_watched entries for that user+show.
    """
    entry = (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if entry:
        db.delete(entry)

        still_tracked = _is_on_other_list(db, user_id, content_type, content_id)

        # If the user is no longer on any list for this TV show, clear their episode progress
        if not still_tracked and content_type == "tv":
            db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=content_id).delete()

        if not still_tracked:
            if content_type == "movie":
                movie = db.query(Movie).filter_by(id=content_id).first()
                if movie:
                    movie.tracking_count -= 1
                    if movie.tracking_count <= 0:
                        db.delete(movie)
            elif content_type == "tv":
                show = db.query(Show).filter_by(id=content_id).first()
                if show:
                    show.tracking_count -= 1
                    if show.tracking_count <= 0:
                        db.query(EpisodeWatched).filter_by(show_id=content_id).delete()
                        db.query(Episode).filter_by(show_id=content_id).delete()
                        db.delete(show)

        db.commit()
        return {"message": "Removed from watched"}
    return {"message": "Not found in watched list"}


def _get_watched_items(db: Session, user_id: str, content_type: str):
    if content_type == "tv":
        model, options, content_id_col, serialize = Show, _show_query_options_list(), Show.id, serialize_show_list
    else:
        model, options, content_id_col, serialize = Movie, _movie_query_options_list(), Movie.id, serialize_movie_list

    rows = (
        db.query(model, Watched.rating, Watched.watched_at)
        .options(*options)
        .select_from(Watched)
        .join(model, and_(
            Watched.content_id == content_id_col,
            Watched.content_type == content_type,
            Watched.user_id == user_id,
        ))
        .all()
    )
    return [
        {**serialize(item), "user_rating": rating, "watched_at": watched_at.isoformat() if watched_at else None}
        for item, rating, watched_at in rows
    ]


def get_watched(db: Session, user_id: str):
    movies = _get_watched_items(db, user_id, "movie")
    shows = _get_watched_items(db, user_id, "tv")
    return {"movies": movies, "shows": shows}
