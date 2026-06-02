from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import and_, func, union_all, select, literal, null
from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.show import Show
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.services.watchlist_service import _is_tracked_on_any
from app.services.media_upsert import ensure_movie_stub_in_db, ensure_show_stub_in_db, decrement_tracking_count


def _is_on_other_list(
    db: Session, user_id: str, content_type: str, content_id: int
) -> bool:
    """Return True if the item exists on Watchlist or Watched."""
    return _is_tracked_on_any(db, user_id, content_type, content_id, Watchlist, Watched)


def _get_currently_watching_items(db: Session, user_id: str, content_type: str):
    # The currently-watching strip only needs basic card fields — no seasons,
    # genres, or providers — so skip the heavy selectinload options.
    #
    # Ordering: most recently added or watched first. For shows that means
    # greatest(added_at, latest episode_watched.watched_at) so marking an
    # episode bumps the show to the front. Movies use added_at.
    if content_type == "tv":
        ew_max_subq = (
            select(
                EpisodeWatched.show_id.label("show_id"),
                func.max(EpisodeWatched.watched_at).label("last_watched_at"),
            )
            .where(EpisodeWatched.user_id == user_id)
            .group_by(EpisodeWatched.show_id)
            .subquery()
        )
        # COALESCE first so both inputs to GREATEST are non-null — PostgreSQL
        # would handle NULL fine, but the SQLite test shim registers a Python
        # `max` UDF that errors on None.
        order_expr = func.greatest(
            CurrentlyWatching.added_at,
            func.coalesce(ew_max_subq.c.last_watched_at, CurrentlyWatching.added_at),
        )
        items = (
            db.query(Show)
            .select_from(CurrentlyWatching)
            .join(
                Show,
                and_(
                    CurrentlyWatching.content_id == Show.id,
                    CurrentlyWatching.content_type == "tv",
                    CurrentlyWatching.user_id == user_id,
                ),
            )
            .outerjoin(ew_max_subq, ew_max_subq.c.show_id == CurrentlyWatching.content_id)
            .order_by(order_expr.desc())
            .all()
        )
        return [
            {
                "id": s.id,
                "name": s.name,
                "poster_path": s.poster_path,
                "backdrop_path": s.backdrop_path,
                "air_time": s.air_time,
                "air_timezone": s.air_timezone,
                "vote_average": s.vote_average,
                "status": s.status,
                "in_production": s.in_production,
            }
            for s in items
        ]
    else:
        items = (
            db.query(Movie)
            .select_from(CurrentlyWatching)
            .join(
                Movie,
                and_(
                    CurrentlyWatching.content_id == Movie.id,
                    CurrentlyWatching.content_type == "movie",
                    CurrentlyWatching.user_id == user_id,
                ),
            )
            .order_by(CurrentlyWatching.added_at.desc())
            .all()
        )
        return [
            {
                "id": m.id,
                "title": m.title,
                "poster_path": m.poster_path,
                "backdrop_path": m.backdrop_path,
                "runtime": m.runtime,
                "release_date": m.release_date,
                "vote_average": m.vote_average,
                "status": m.status,
            }
            for m in items
        ]


def add_to_currently_watching(
    db: Session, user_id: str, content_type: str, content_id: int
):
    existing = (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if existing:
        return existing

    already_tracked = _is_on_other_list(db, user_id, content_type, content_id)

    entry = CurrentlyWatching(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
    )
    db.add(entry)

    if content_type == "movie":
        ensure_movie_stub_in_db(db, content_id, already_tracked)
    elif content_type == "tv":
        ensure_show_stub_in_db(db, content_id, already_tracked)

    db.commit()
    db.refresh(entry)

    return entry


def remove_from_currently_watching(
    db: Session, user_id: str, content_type: str, content_id: int, commit: bool = True
):
    entry = (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not entry:
        return {"message": "Item not found in currently watching"}
    db.delete(entry)

    still_tracked = _is_on_other_list(db, user_id, content_type, content_id)

    if not still_tracked:
        decrement_tracking_count(db, content_type, content_id)

    if commit:
        db.commit()
    return {"message": "Removed from currently watching"}


def get_currently_watching(db: Session, user_id: str):
    """Single UNION ALL query — one DB round-trip instead of two.

    Each row carries an order_ts so the caller can sort by "most recently
    added or watched": for shows that's greatest(added_at, latest
    episode_watched.watched_at), for movies it's added_at.
    """
    ew_max_subq = (
        select(
            EpisodeWatched.show_id.label("show_id"),
            func.max(EpisodeWatched.watched_at).label("last_watched_at"),
        )
        .where(EpisodeWatched.user_id == user_id)
        .group_by(EpisodeWatched.show_id)
        .subquery()
    )
    # COALESCE first so both inputs to GREATEST are non-null — PostgreSQL
    # would handle NULL fine, but the SQLite test shim registers a Python
    # `max` UDF that errors on None.
    show_order_ts = func.greatest(
        CurrentlyWatching.added_at,
        func.coalesce(ew_max_subq.c.last_watched_at, CurrentlyWatching.added_at),
    )

    show_q = (
        select(
            literal("tv").label("content_type"),
            Show.id,
            Show.name.label("name"),
            null().label("title"),
            Show.poster_path,
            Show.backdrop_path,
            null().label("runtime"),
            null().label("release_date"),
            Show.vote_average,
            Show.status,
            Show.in_production,
            Show.air_time,
            Show.air_timezone,
            show_order_ts.label("order_ts"),
        )
        .select_from(CurrentlyWatching)
        .join(
            Show,
            and_(
                CurrentlyWatching.content_id == Show.id,
                CurrentlyWatching.content_type == "tv",
            ),
        )
        .outerjoin(ew_max_subq, ew_max_subq.c.show_id == CurrentlyWatching.content_id)
        .where(CurrentlyWatching.user_id == user_id)
    )
    movie_q = (
        select(
            literal("movie").label("content_type"),
            Movie.id,
            null().label("name"),
            Movie.title.label("title"),
            Movie.poster_path,
            Movie.backdrop_path,
            Movie.runtime.label("runtime"),
            Movie.release_date.label("release_date"),
            Movie.vote_average,
            Movie.status,
            null().label("in_production"),
            null().label("air_time"),
            null().label("air_timezone"),
            CurrentlyWatching.added_at.label("order_ts"),
        )
        .select_from(CurrentlyWatching)
        .join(
            Movie,
            and_(
                CurrentlyWatching.content_id == Movie.id,
                CurrentlyWatching.content_type == "movie",
            ),
        )
        .where(CurrentlyWatching.user_id == user_id)
    )

    rows = db.execute(union_all(show_q, movie_q)).all()
    movies_with_ts, shows_with_ts = [], []
    for row in rows:
        (
            ct,
            id_,
            name,
            title,
            poster_path,
            backdrop_path,
            runtime,
            release_date,
            vote_average,
            status,
            in_production,
            air_time,
            air_timezone,
            order_ts,
        ) = row
        if ct == "tv":
            shows_with_ts.append(
                (
                    order_ts,
                    {
                        "id": id_,
                        "name": name,
                        "poster_path": poster_path,
                        "backdrop_path": backdrop_path,
                        "air_time": air_time,
                        "air_timezone": air_timezone,
                        "vote_average": vote_average,
                        "status": status,
                        "in_production": in_production,
                    },
                )
            )
        else:
            movies_with_ts.append(
                (
                    order_ts,
                    {
                        "id": id_,
                        "title": title,
                        "poster_path": poster_path,
                        "backdrop_path": backdrop_path,
                        "runtime": runtime,
                        "release_date": str(release_date) if release_date else None,
                        "vote_average": vote_average,
                        "status": status,
                    },
                )
            )

    _epoch = datetime.min.replace(tzinfo=timezone.utc)
    shows_with_ts.sort(key=lambda t: t[0] or _epoch, reverse=True)
    movies_with_ts.sort(key=lambda t: t[0] or _epoch, reverse=True)
    return {
        "movies": [m for _, m in movies_with_ts],
        "shows": [s for _, s in shows_with_ts],
    }
