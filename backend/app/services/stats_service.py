# app/services/stats_service.py
import time
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case, text, union_all, select
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.episode_watched import EpisodeWatched
from app.models.genre import Genre, MovieGenre, ShowGenre
from app.models.user import User

_stats_cache: dict[str, tuple[float, dict]] = {}
_STATS_TTL = 300  # 5 minutes


def invalidate_stats_cache(user_id: str) -> None:
    _stats_cache.pop(user_id, None)


def _compute_streak(db: Session, user_id: str, tz: str = "UTC") -> dict:
    # Single CTE: union both tables → gap detection via LAG → streak groups → aggregation.
    # date - date returns an integer in PostgreSQL; first-row LAG is NULL so its gap = 1 (new group).
    # watched_at is stored as UTC; AT TIME ZONE converts to the user's local date so streaks
    # roll over at the user's local midnight rather than UTC midnight.
    row = db.execute(
        text("""
            WITH all_dates AS (
                SELECT DISTINCT (watched_at AT TIME ZONE :tz)::date AS watch_date
                FROM watched
                WHERE user_id = :uid AND watched_at IS NOT NULL
                UNION
                SELECT DISTINCT (watched_at AT TIME ZONE :tz)::date AS watch_date
                FROM episode_watched
                WHERE user_id = :uid AND watched_at IS NOT NULL
            ),
            with_gap AS (
                SELECT
                    watch_date,
                    CASE
                        WHEN watch_date - LAG(watch_date) OVER (ORDER BY watch_date) = 1 THEN 0
                        ELSE 1
                    END AS gap
                FROM all_dates
            ),
            grouped AS (
                SELECT watch_date, SUM(gap) OVER (ORDER BY watch_date) AS grp
                FROM with_gap
            ),
            runs AS (
                SELECT grp, COUNT(*) AS streak_len, MAX(watch_date) AS last_date
                FROM grouped
                GROUP BY grp
            )
            SELECT
                COALESCE(MAX(streak_len), 0) AS longest,
                COALESCE(MAX(CASE WHEN last_date >= (NOW() AT TIME ZONE :tz)::date - 1 THEN streak_len ELSE 0 END), 0) AS current_streak,
                COALESCE(MAX(CASE WHEN last_date = (NOW() AT TIME ZONE :tz)::date THEN 1 ELSE 0 END), 0) AS today_logged
            FROM runs
        """),
        {"uid": user_id, "tz": tz},
    ).one()
    return {
        "current": row.current_streak,
        "longest": row.longest,
        "today_logged": bool(row.today_logged),
    }


def get_user_stats(db: Session, user_id: str) -> dict:
    cached = _stats_cache.get(user_id)
    if cached and time.monotonic() - cached[0] < _STATS_TTL:
        return cached[1]

    # --- Counts + averages ---
    watched_row = (
        db.query(
            func.count(case((Watched.content_type == "movie", 1))).label("movies_watched"),
            func.count(case((Watched.content_type == "tv", 1))).label("shows_watched"),
            func.avg(case((and_(Watched.content_type == "movie", Watched.rating.isnot(None)), Watched.rating))).label("movie_avg"),
            func.avg(case((and_(Watched.content_type == "tv", Watched.rating.isnot(None)), Watched.rating))).label("show_avg"),
        )
        .filter(Watched.user_id == user_id)
        .one()
    )

    # --- Watchlist counts ---
    watchlist_row = (
        db.query(
            func.count(case((Watchlist.content_type == "movie", 1))).label("movies_watchlist"),
            func.count(case((Watchlist.content_type == "tv", 1))).label("shows_watchlist"),
        )
        .filter(Watchlist.user_id == user_id)
        .one()
    )

    # --- Episode count ---
    episodes_watched = (
        db.query(func.count(EpisodeWatched.id))
        .filter(EpisodeWatched.user_id == user_id)
        .scalar()
        or 0
    )

    # --- Rating distribution bucketed in SQL ---
    bucket_expr = func.least(5, func.greatest(1, func.round(Watched.rating)))
    dist_rows = (
        db.query(bucket_expr.label("bucket"), func.count().label("cnt"))
        .filter(Watched.user_id == user_id, Watched.rating.isnot(None))
        .group_by(bucket_expr)
        .all()
    )
    dist_map = {int(r.bucket): r.cnt for r in dist_rows}
    dist_list = [{"rating": i, "count": dist_map.get(i, 0)} for i in range(1, 6)]

    # --- Top genres: single UNION ALL + aggregate in DB ---
    movie_q = (
        select(Genre.name.label("name"), func.count(Genre.id).label("cnt"))
        .join(MovieGenre, Genre.id == MovieGenre.genre_id)
        .join(Watched, and_(
            Watched.content_id == MovieGenre.movie_id,
            Watched.content_type == "movie",
            Watched.user_id == user_id,
        ))
        .group_by(Genre.name)
    )
    show_q = (
        select(Genre.name.label("name"), func.count(Genre.id).label("cnt"))
        .join(ShowGenre, Genre.id == ShowGenre.genre_id)
        .join(Watched, and_(
            Watched.content_id == ShowGenre.show_id,
            Watched.content_type == "tv",
            Watched.user_id == user_id,
        ))
        .group_by(Genre.name)
    )
    combined = union_all(movie_q, show_q).subquery()
    genre_rows = (
        db.query(combined.c.name, func.sum(combined.c.cnt).label("total"))
        .group_by(combined.c.name)
        .order_by(func.sum(combined.c.cnt).desc())
        .limit(8)
        .all()
    )
    top_genres = [{"name": r.name, "count": int(r.total)} for r in genre_rows]

    user = db.query(User.digest_timezone).filter(User.id == user_id).one_or_none()
    user_tz = user.digest_timezone if user and user.digest_timezone else "UTC"

    movie_avg = watched_row.movie_avg
    show_avg = watched_row.show_avg

    result = {
        "counts": {
            "movies_watched": watched_row.movies_watched or 0,
            "shows_watched": watched_row.shows_watched or 0,
            "episodes_watched": episodes_watched,
            "movies_watchlist": watchlist_row.movies_watchlist or 0,
            "shows_watchlist": watchlist_row.shows_watchlist or 0,
        },
        "ratings": {
            "movie_avg": round(movie_avg, 1) if movie_avg is not None else None,
            "show_avg": round(show_avg, 1) if show_avg is not None else None,
            "distribution": dist_list,
        },
        "top_genres": top_genres,
        "streak": _compute_streak(db, user_id, user_tz),
    }
    _stats_cache[user_id] = (time.monotonic(), result)
    return result
