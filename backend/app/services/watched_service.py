# app/services/watched_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.watchlist_service import (
    get_theatrical_release_date,
    serialize_show,
    serialize_movie,
    _upsert_genres_for_show,
    _upsert_genres_for_movie,
    _upsert_providers_for_show,
    _upsert_providers_for_movie,
    _upsert_seasons_for_show,
    _show_query_options,
    _movie_query_options,
)
from app.services.episode_service import sync_show_episodes
from app.services.activity_service import log_activity
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.db.session import SessionLocal


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

    # Only increment tracking_count if not already on any other list
    already_tracked = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None or (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None

    entry = Watched(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        watched_at=datetime.utcnow(),
        rating=rating,
    )
    db.add(entry)

    if content_type == "movie":
        movie = db.query(Movie).filter_by(id=content_id).first()
        if movie:
            if not already_tracked:
                movie.tracking_count += 1
        else:
            movie_data = fetch_movie_from_tmdb(
                content_id, "watch/providers,release_dates,images"
            )
            if not movie_data or not movie_data.get("title"):
                raise ValueError("Cannot add movie without a title")
            us_providers = (
                movie_data.get("watch/providers", {}).get("results", {}).get("US", {})
            )
            theatrical_release_date = get_theatrical_release_date(movie_data)
            all_logos = movie_data.get("images", {}).get("logos", [])
            english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
            logo = english_logos[0]["file_path"] if english_logos else None
            movie = Movie(
                id=movie_data["id"],
                imdb_id=movie_data.get("imdb_id"),
                backdrop_path=movie_data.get("backdrop_path"),
                logo_path=logo,
                budget=movie_data.get("budget"),
                homepage=movie_data.get("homepage"),
                tagline=movie_data.get("tagline"),
                poster_path=movie_data.get("poster_path"),
                overview=movie_data.get("overview"),
                release_date=theatrical_release_date,
                revenue=movie_data.get("revenue"),
                runtime=movie_data.get("runtime"),
                status=movie_data.get("status"),
                title=movie_data.get("title"),
                tracking_count=1,
            )
            db.add(movie)
            db.flush()
            _upsert_genres_for_movie(db, movie, movie_data.get("genres", []))
            _upsert_providers_for_movie(db, movie, us_providers)

    elif content_type == "tv":
        show = db.query(Show).filter_by(id=content_id).first()
        if show:
            if not already_tracked:
                show.tracking_count += 1
        else:
            show_data = fetch_show_from_tmdb(content_id, "watch/providers,images")
            if not show_data or not show_data.get("name"):
                raise ValueError("Cannot add show without a name")
            us_providers = (
                show_data.get("watch/providers", {}).get("results", {}).get("US", {})
            )
            all_logos = show_data.get("images", {}).get("logos", [])
            english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
            logo = english_logos[0]["file_path"] if english_logos else None
            show = Show(
                id=show_data["id"],
                name=show_data["name"],
                backdrop_path=show_data.get("backdrop_path"),
                logo_path=logo,
                last_air_date=show_data.get("last_air_date"),
                homepage=show_data.get("homepage"),
                in_production=show_data.get("in_production"),
                number_of_seasons=show_data.get("number_of_seasons"),
                number_of_episodes=show_data.get("number_of_episodes"),
                status=show_data.get("status"),
                tagline=show_data.get("tagline"),
                overview=show_data.get("overview"),
                type=show_data.get("type"),
                first_air_date=show_data.get("first_air_date"),
                poster_path=show_data.get("poster_path"),
                tracking_count=1,
            )
            db.add(show)
            db.flush()
            _upsert_genres_for_show(db, show, show_data.get("genres", []))
            _upsert_providers_for_show(db, show, us_providers)
            _upsert_seasons_for_show(db, show, show_data.get("seasons", []))

    # Log activity
    if content_type == "movie":
        item = db.query(Movie).filter_by(id=content_id).first()
        log_activity(db, user_id, "watched", content_type, content_id,
                     item.title if item else None, item.poster_path if item else None)
    elif content_type == "tv":
        item = db.query(Show).filter_by(id=content_id).first()
        log_activity(db, user_id, "watched", content_type, content_id,
                     item.name if item else None, item.poster_path if item else None)

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
        if content_type == "movie":
            item = db.query(Movie).filter_by(id=content_id).first()
            log_activity(db, user_id, "rated", content_type, content_id,
                         item.title if item else None, item.poster_path if item else None,
                         rating=rating)
        elif content_type == "tv":
            item = db.query(Show).filter_by(id=content_id).first()
            log_activity(db, user_id, "rated", content_type, content_id,
                         item.name if item else None, item.poster_path if item else None,
                         rating=rating)

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
        if content_type == "tv":
            db.query(EpisodeWatched).filter_by(
                user_id=user_id, show_id=content_id
            ).delete()

        # Only decrement tracking_count if not still on any other list
        still_tracked = (
            db.query(Watchlist)
            .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
            .first()
        ) is not None or (
            db.query(CurrentlyWatching)
            .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
            .first()
        ) is not None

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


def get_watched(db: Session, user_id: str):
    movies = get_watched_movies_info(db, user_id)
    shows = get_watched_tv_info(db, user_id)
    return {"movies": movies, "shows": shows}


def get_watched_movies_info(db: Session, user_id: str):
    rows = (
        db.query(Movie, Watched.rating)
        .options(*_movie_query_options())
        .select_from(Watched)
        .join(
            Movie,
            and_(
                Watched.content_id == Movie.id,
                Watched.content_type == "movie",
                Watched.user_id == user_id,
            ),
        )
        .all()
    )
    return [{**serialize_movie(movie), "user_rating": rating} for movie, rating in rows]


def get_watched_tv_info(db: Session, user_id: str):
    rows = (
        db.query(Show, Watched.rating)
        .options(*_show_query_options())
        .select_from(Watched)
        .join(
            Show,
            and_(
                Watched.content_id == Show.id,
                Watched.content_type == "tv",
                Watched.user_id == user_id,
            ),
        )
        .all()
    )
    return [{**serialize_show(show), "user_rating": rating} for show, rating in rows]
