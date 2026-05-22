# app/services/watched_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_, text
from datetime import datetime, timezone
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.services.watchlist_service import _get_item_title_and_poster, _is_tracked_on_any
from app.services.media_serializers import (
    serialize_show_list,
    serialize_movie_list,
    _show_query_options_list,
    _movie_query_options_list,
)
from app.services.media_upsert import ensure_movie_stub_in_db, ensure_show_stub_in_db, decrement_tracking_count
from app.services.episode_service import sync_show_episodes
from app.services.activity_service import log_activity
from app.models.activity import Activity
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.db.session import SessionLocal, _is_sqlite


def _is_on_other_list(
    db: Session, user_id: str, content_type: str, content_id: int
) -> bool:
    """Return True if the item exists on Watchlist or CurrentlyWatching."""
    return _is_tracked_on_any(
        db, user_id, content_type, content_id, Watchlist, CurrentlyWatching
    )


def add_to_watched(
    db: Session, user_id: str, content_type: str, content_id: int, rating: float = None, commit: bool = True
):
    """
    Mark a movie or show as watched.
    """
    # Single round-trip: existing check + other-list check
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watched
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS existing_id,
            EXISTS(
                SELECT 1 FROM watchlist
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS already_tracked
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.existing_id is not None:
        return {"id": row.existing_id, "content_type": content_type, "content_id": content_id}

    already_tracked = bool(row.already_tracked)

    entry = Watched(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        watched_at=datetime.now(timezone.utc),
        rating=rating,
    )
    db.add(entry)

    if content_type == "movie":
        media = ensure_movie_stub_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "watched", content_type, content_id, media.title or None, media.poster_path)
    elif content_type == "tv":
        media = ensure_show_stub_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "watched", content_type, content_id, media.name or None, media.poster_path)
    else:
        log_activity(db, user_id, "watched", content_type, content_id, None, None)

    # entry.id is populated by log_activity's db.flush() — no post-commit SELECT needed
    result = {
        "id": entry.id,
        "user_id": entry.user_id,
        "content_type": entry.content_type,
        "content_id": entry.content_id,
        "watched_at": entry.watched_at.isoformat() if entry.watched_at else None,
        "rating": entry.rating,
    }
    if commit:
        db.commit()
    return result


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
            watched_at=datetime.now(timezone.utc),
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
        existing_activity = (
            db.query(Activity)
            .filter_by(
                user_id=user_id,
                activity_type="watched",
                content_type=content_type,
                content_id=content_id,
            )
            .first()
        )
        if existing_activity:
            existing_activity.rating = rating
            existing_activity.created_at = datetime.now(timezone.utc)
        else:
            log_activity(
                db, user_id, "watched", content_type, content_id, title, poster, rating=rating
            )

    db.commit()
    db.refresh(entry)
    return entry


def remove_from_watched(db: Session, user_id: str, content_type: str, content_id: int):
    """
    Remove a movie or show from the watched list.
    For TV shows, also clears all episode_watched entries for that user+show.
    """
    # Single round-trip: find entry + check if still tracked elsewhere
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watched
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS watched_id,
            EXISTS(
                SELECT 1 FROM watchlist
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS still_tracked
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.watched_id is None:
        return {"message": "Not found in watched list"}

    db.execute(text("DELETE FROM watched WHERE id = :id"), {"id": row.watched_id})

    if not bool(row.still_tracked):
        if content_type == "tv":
            db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=content_id).delete()
        decrement_tracking_count(db, content_type, content_id)

    db.commit()
    return {"message": "Removed from watched"}


def _get_watched_items(db: Session, user_id: str, content_type: str):
    if content_type == "tv":
        model, options, content_id_col, serialize = (
            Show,
            _show_query_options_list(),
            Show.id,
            serialize_show_list,
        )
    else:
        model, options, content_id_col, serialize = (
            Movie,
            _movie_query_options_list(),
            Movie.id,
            serialize_movie_list,
        )

    rows = (
        db.query(model, Watched.rating, Watched.watched_at)
        .options(*options)
        .select_from(Watched)
        .join(
            model,
            and_(
                Watched.content_id == content_id_col,
                Watched.content_type == content_type,
                Watched.user_id == user_id,
            ),
        )
        .all()
    )
    return [
        {
            **serialize(item),
            "user_rating": rating,
            "watched_at": watched_at.isoformat() if watched_at else None,
        }
        for item, rating, watched_at in rows
    ]


def _fetch_watched_movies_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            m.id, m.backdrop_path, m.logo_path, m.overview, m.poster_path,
            m.release_date, m.runtime, m.status, m.title,
            m.tracking_count, m.vote_average, m.certification,
            w.rating AS user_rating, w.watched_at,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name))
                    FILTER (WHERE g.id IS NOT NULL),
                '[]'::json
            ) AS genres,
            COALESCE(
                array_agg(DISTINCT mp.provider_id)
                    FILTER (WHERE mp.provider_id IS NOT NULL),
                ARRAY[]::integer[]
            ) AS flatrate_provider_ids
        FROM watched w
        JOIN movie m ON m.id = w.content_id AND w.content_type = 'movie'
        LEFT JOIN movie_genre mg ON mg.movie_id = m.id
        LEFT JOIN genre g ON g.id = mg.genre_id
        LEFT JOIN movie_provider mp ON mp.movie_id = m.id AND mp.flatrate = true
        WHERE w.user_id = :uid
        GROUP BY m.id, w.rating, w.watched_at
    """), {"uid": user_id}).mappings().all()
    return [
        {
            "id": r["id"],
            "backdrop_path": r["backdrop_path"],
            "logo_path": r["logo_path"],
            "overview": r["overview"],
            "poster_path": r["poster_path"],
            "release_date": r["release_date"],
            "runtime": r["runtime"],
            "status": r["status"],
            "title": r["title"],
            "tracking_count": r["tracking_count"],
            "vote_average": r["vote_average"],
            "certification": r["certification"],
            "genres": r["genres"],
            "flatrate_provider_ids": r["flatrate_provider_ids"],
            "user_rating": r["user_rating"],
            "watched_at": r["watched_at"].isoformat() if r["watched_at"] else None,
        }
        for r in rows
    ]


def _fetch_watched_shows_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            sh.id, sh.name, sh.backdrop_path, sh.logo_path, sh.first_air_date,
            sh.last_air_date, sh.in_production, sh.number_of_seasons,
            sh.number_of_episodes, sh.overview, sh.poster_path, sh.status,
            sh.tracking_count, sh.vote_average, sh.certification,
            w.rating AS user_rating, w.watched_at,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name))
                    FILTER (WHERE g.id IS NOT NULL),
                '[]'::json
            ) AS genres,
            COALESCE(
                array_agg(DISTINCT sp.provider_id)
                    FILTER (WHERE sp.provider_id IS NOT NULL),
                ARRAY[]::integer[]
            ) AS flatrate_provider_ids
        FROM watched w
        JOIN show sh ON sh.id = w.content_id AND w.content_type = 'tv'
        LEFT JOIN show_genre sg ON sg.show_id = sh.id
        LEFT JOIN genre g ON g.id = sg.genre_id
        LEFT JOIN show_provider sp ON sp.show_id = sh.id AND sp.flatrate = true
        WHERE w.user_id = :uid
        GROUP BY sh.id, w.rating, w.watched_at
    """), {"uid": user_id}).mappings().all()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "backdrop_path": r["backdrop_path"],
            "logo_path": r["logo_path"],
            "first_air_date": r["first_air_date"],
            "last_air_date": r["last_air_date"],
            "in_production": r["in_production"],
            "number_of_seasons": r["number_of_seasons"],
            "number_of_episodes": r["number_of_episodes"],
            "overview": r["overview"],
            "poster_path": r["poster_path"],
            "status": r["status"],
            "tracking_count": r["tracking_count"],
            "vote_average": r["vote_average"],
            "certification": r["certification"],
            "genres": r["genres"],
            "flatrate_provider_ids": r["flatrate_provider_ids"],
            "user_rating": r["user_rating"],
            "watched_at": r["watched_at"].isoformat() if r["watched_at"] else None,
        }
        for r in rows
    ]


def get_watched(db: Session, user_id: str):
    if _is_sqlite:
        return {
            "movies": _get_watched_items(db, user_id, "movie"),
            "shows": _get_watched_items(db, user_id, "tv"),
        }

    return {
        "movies": _fetch_watched_movies_pg(db, user_id),
        "shows": _fetch_watched_shows_pg(db, user_id),
    }
