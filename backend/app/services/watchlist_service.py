# app/services/watchlist_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_, select, exists, literal, union_all, func
from datetime import datetime, timezone
from fastapi import HTTPException
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.show import Show
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.provider import ShowProvider, MovieProvider
from app.models.user import User
from app.db.session import _is_sqlite
from app.services.media_serializers import (
    serialize_show_list,
    serialize_movie_list,
    serialize_show_calendar,
    _show_query_options_list,
    _movie_query_options_list,
)
from app.services.media_upsert import ensure_movie_stub_in_db, ensure_show_stub_in_db, decrement_tracking_count
from app.services.activity_service import log_activity
from sqlalchemy import text
from collections import defaultdict


_TRACKING_LIMIT = 30


def assert_can_track(db: Session, uid: str) -> None:
    """Raise 403 if a free-tier user has hit the tracking limit."""
    user = db.query(User).filter(User.id == uid).first()
    if user and user.subscription_tier != "free":
        return
    tracked = db.execute(
        text(
            "SELECT (SELECT COUNT(*) FROM watchlist WHERE user_id = :u)"
            " + (SELECT COUNT(*) FROM currently_watching WHERE user_id = :u)"
        ),
        {"u": uid},
    ).scalar()
    if tracked >= _TRACKING_LIMIT:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "tracking_limit_reached",
                "message": f"Free accounts can track up to {_TRACKING_LIMIT} titles.",
                "limit": _TRACKING_LIMIT,
                "current": tracked,
            },
        )


def _get_item_title_and_poster(
    db: Session, content_type: str, content_id: int
) -> tuple[str | None, str | None]:
    if content_type == "movie":
        item = db.query(Movie).filter_by(id=content_id).first()
        return (item.title if item else None), (item.poster_path if item else None)
    item = db.query(Show).filter_by(id=content_id).first()
    return (item.name if item else None), (item.poster_path if item else None)


def _is_tracked_on_any(
    db: Session, user_id: str, content_type: str, content_id: int, *models
) -> bool:
    """Return True if the item exists on ANY of the given list models — single UNION ALL query."""
    subqs = [
        select(literal(1))
        .select_from(model)
        .where(
            model.user_id == user_id,
            model.content_type == content_type,
            model.content_id == content_id,
        )
        for model in models
    ]
    return db.execute(select(exists(union_all(*subqs).subquery()))).scalar() or False


def _is_on_other_list(
    db: Session, user_id: str, content_type: str, content_id: int
) -> bool:
    """Return True if the item exists on CurrentlyWatching or Watched."""
    return _is_tracked_on_any(
        db, user_id, content_type, content_id, CurrentlyWatching, Watched
    )


def add_to_watchlist(db: Session, user_id: str, content_type: str, content_id: int, notify: bool = True):
    """
    Add a movie or show to the user's watchlist.
    """
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watchlist
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS existing_id,
            (SELECT COALESCE(MAX(sort_key), 0) FROM watchlist WHERE user_id = :uid) AS max_sort_key,
            EXISTS(
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM watched
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS already_tracked,
            COALESCE((SELECT subscription_tier FROM "user" WHERE id = :uid), 'free') AS subscription_tier,
            (SELECT COUNT(*) FROM watchlist WHERE user_id = :uid) +
            (SELECT COUNT(*) FROM currently_watching WHERE user_id = :uid) AS tracked_count
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.existing_id is not None:
        return {"id": row.existing_id, "content_type": content_type, "content_id": content_id}

    if row.subscription_tier == "free" and row.tracked_count >= _TRACKING_LIMIT:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "tracking_limit_reached",
                "message": f"Free accounts can track up to {_TRACKING_LIMIT} titles.",
                "limit": _TRACKING_LIMIT,
                "current": row.tracked_count,
            },
        )

    already_tracked = bool(row.already_tracked)
    max_sort_key = row.max_sort_key or 0

    entry = Watchlist(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        added_at=datetime.now(timezone.utc),
        sort_key=max_sort_key + 1000,
        notify=notify,
    )
    db.add(entry)

    if content_type == "movie":
        media = ensure_movie_stub_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.title or None, media.poster_path)
    elif content_type == "tv":
        media = ensure_show_stub_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.name or None, media.poster_path)

    result = {
        "id": entry.id,
        "user_id": entry.user_id,
        "content_type": entry.content_type,
        "content_id": entry.content_id,
        "added_at": entry.added_at.isoformat() if entry.added_at else None,
        "sort_key": entry.sort_key,
        "notify": entry.notify,
    }
    db.commit()
    return result


def _renormalize_sort_keys(db: Session, user_id: str) -> None:
    """Re-space all of a user's watchlist sort_keys to multiples of 1000."""
    items = (
        db.query(Watchlist)
        .filter_by(user_id=user_id)
        .order_by(Watchlist.sort_key)
        .all()
    )
    for i, item in enumerate(items, start=1):
        item.sort_key = i * 1000


def reorder_watchlist_item(
    db: Session,
    user_id: str,
    content_type: str,
    content_id: int,
    before_id: int | None,
    after_id: int | None,
):
    """
    Move a watchlist item so it sits between the items identified by before_id and after_id.
    before_id=None means move to top. after_id=None means move to bottom.
    Renormalizes all sort_keys for the user if any gap drops to <= 10.
    Returns the updated watchlist dict.
    """
    entry = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not entry:
        raise ValueError("Item not in watchlist")

    before_key = 0
    if before_id is not None:
        bk = (
            db.query(Watchlist.sort_key)
            .filter_by(id=before_id, user_id=user_id)
            .scalar()
        )
        if bk is None:
            raise ValueError(f"before_id {before_id} not found in user's watchlist")
        before_key = bk

    if after_id is not None:
        ak = (
            db.query(Watchlist.sort_key)
            .filter_by(id=after_id, user_id=user_id)
            .scalar()
        )
        if ak is None:
            raise ValueError(f"after_id {after_id} not found in user's watchlist")
        after_key = ak
    else:
        max_key = (
            db.query(func.max(Watchlist.sort_key)).filter_by(user_id=user_id).scalar()
            or 0
        )
        after_key = max_key + 2000

    new_sort_key = (before_key + after_key) // 2
    gap_above = new_sort_key - before_key
    gap_below = after_key - new_sort_key

    entry.sort_key = new_sort_key
    db.flush()

    if min(gap_above, gap_below) <= 10:
        _renormalize_sort_keys(db, user_id)

    db.commit()
    return get_watchlist(db, user_id)


def remove_from_watchlist(
    db: Session, user_id: str, content_type: str, content_id: int, commit: bool = True
):
    """
    Remove a movie or show from the user's watchlist.
    """
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watchlist
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS watchlist_id,
            EXISTS(
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM watched
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS still_tracked
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.watchlist_id is None:
        return {"message": "Item not found in watchlist"}

    db.execute(text("DELETE FROM watchlist WHERE id = :id"), {"id": row.watchlist_id})

    if not bool(row.still_tracked):
        if content_type == "tv":
            db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=content_id).delete()
        decrement_tracking_count(db, content_type, content_id)

    if commit:
        db.commit()
    return {"message": "Removed from watchlist"}


def _get_watchlist_items(db: Session, user_id: str, content_type: str):
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
        db.query(model, Watchlist.added_at, Watchlist.sort_key, Watchlist.id)
        .options(*options)
        .select_from(Watchlist)
        .join(
            model,
            and_(
                Watchlist.content_id == content_id_col,
                Watchlist.content_type == content_type,
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.sort_key)
        .all()
    )
    return [
        {
            **serialize(item),
            "added_at": added_at.isoformat() if added_at else None,
            "sort_key": sort_key,
            "watchlist_id": watchlist_id,
        }
        for item, added_at, sort_key, watchlist_id in rows
    ]


def _fetch_watchlist_movies_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            m.id, m.backdrop_path, m.logo_path, m.overview, m.poster_path,
            m.release_date, m.runtime, m.status, m.title,
            m.tracking_count, m.vote_average, m.certification,
            w.added_at, w.sort_key, w.id AS watchlist_id,
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
        FROM watchlist w
        JOIN movie m ON m.id = w.content_id AND w.content_type = 'movie'
        LEFT JOIN movie_genre mg ON mg.movie_id = m.id
        LEFT JOIN genre g ON g.id = mg.genre_id
        LEFT JOIN movie_provider mp ON mp.movie_id = m.id AND mp.flatrate = true
        WHERE w.user_id = :uid
        GROUP BY m.id, w.added_at, w.sort_key, w.id
        ORDER BY w.sort_key
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
            "added_at": r["added_at"].isoformat() if r["added_at"] else None,
            "sort_key": r["sort_key"],
            "watchlist_id": r["watchlist_id"],
        }
        for r in rows
    ]


def _fetch_watchlist_shows_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            sh.id, sh.name, sh.backdrop_path, sh.logo_path, sh.first_air_date,
            sh.last_air_date, sh.in_production, sh.number_of_seasons,
            sh.number_of_episodes, sh.overview, sh.poster_path, sh.status,
            sh.tracking_count, sh.vote_average, sh.certification,
            w.added_at, w.sort_key, w.id AS watchlist_id,
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
        FROM watchlist w
        JOIN show sh ON sh.id = w.content_id AND w.content_type = 'tv'
        LEFT JOIN show_genre sg ON sg.show_id = sh.id
        LEFT JOIN genre g ON g.id = sg.genre_id
        LEFT JOIN show_provider sp ON sp.show_id = sh.id AND sp.flatrate = true
        WHERE w.user_id = :uid
        GROUP BY sh.id, w.added_at, w.sort_key, w.id
        ORDER BY w.sort_key
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
            "added_at": r["added_at"].isoformat() if r["added_at"] else None,
            "sort_key": r["sort_key"],
            "watchlist_id": r["watchlist_id"],
        }
        for r in rows
    ]


def get_watchlist(db: Session, user_id: str):
    # SQLite (tests) doesn't support json_agg — fall back to ORM path.
    if _is_sqlite:
        return {
            "movies": _get_watchlist_items(db, user_id, "movie"),
            "shows": _get_watchlist_items(db, user_id, "tv"),
        }

    return {
        "movies": _fetch_watchlist_movies_pg(db, user_id),
        "shows": _fetch_watchlist_shows_pg(db, user_id),
    }


def get_watchlist_status(id: int, db: Session, user_id: str, content_type: str):
    row = db.execute(
        text("""
        SELECT 'Currently Watching' AS status, NULL::float AS rating
        FROM currently_watching
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        UNION ALL
        SELECT 'Want To Watch', NULL
        FROM watchlist
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        UNION ALL
        SELECT 'Watched', rating
        FROM watched
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        LIMIT 1
    """),
        {"uid": user_id, "cid": id, "ctype": content_type},
    ).first()

    if not row:
        return {"status": "none"}
    if row.status == "Watched":
        return {"status": "Watched", "rating": row.rating}
    return {"status": row.status}


def get_tv_calendar(
    db: Session,
    user_id: str,
    from_date: str,
    to_date: str,
):
    """
    Return TV shows in the user's watchlist + currently-watching list with episodes
    in the requested date window. Shows with no episodes in the window are omitted.
    """
    watchlist_ids = {
        row.content_id
        for row in db.query(Watchlist.content_id)
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "tv")
        .all()
    }
    cw_ids = {
        row.content_id
        for row in db.query(CurrentlyWatching.content_id)
        .filter(
            CurrentlyWatching.user_id == user_id, CurrentlyWatching.content_type == "tv"
        )
        .all()
    }
    show_ids = list(watchlist_ids | cw_ids)

    if not show_ids:
        return []

    episodes = (
        db.query(Episode)
        .filter(
            Episode.show_id.in_(show_ids),
            Episode.air_date >= from_date,
            Episode.air_date <= to_date,
        )
        .order_by(Episode.show_id, Episode.season_number, Episode.episode_number)
        .all()
    )

    eps_by_show: dict[int, list] = defaultdict(list)
    for ep in episodes:
        eps_by_show[ep.show_id].append(
            {
                "id": ep.id,
                "show_id": ep.show_id,
                "season_number": ep.season_number,
                "episode_number": ep.episode_number,
                "name": ep.name,
                "air_date": str(ep.air_date) if ep.air_date else None,
                "runtime": ep.runtime,
                "still_path": ep.still_path,
                "overview": ep.overview,
                "vote_average": ep.vote_average,
                "episode_type": ep.episode_type,
            }
        )

    shows_in_window = db.query(Show).filter(Show.id.in_(list(eps_by_show.keys()))).all()

    return [
        {"show": serialize_show_calendar(show), "episodes": eps_by_show[show.id]}
        for show in shows_in_window
    ]
