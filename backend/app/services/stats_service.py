# app/services/stats_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.episode_watched import EpisodeWatched
from app.models.genre import Genre, MovieGenre, ShowGenre


def get_user_stats(db: Session, user_id: str) -> dict:
    # --- Counts + averages in one query against watched ---
    watched_row = (
        db.query(
            func.count(case((Watched.content_type == "movie", 1))).label(
                "movies_watched"
            ),
            func.count(case((Watched.content_type == "tv", 1))).label("shows_watched"),
            func.avg(
                case(
                    (
                        and_(
                            Watched.content_type == "movie", Watched.rating.isnot(None)
                        ),
                        Watched.rating,
                    )
                )
            ).label("movie_avg"),
            func.avg(
                case(
                    (
                        and_(Watched.content_type == "tv", Watched.rating.isnot(None)),
                        Watched.rating,
                    )
                )
            ).label("show_avg"),
        )
        .filter(Watched.user_id == user_id)
        .one()
    )

    # --- Watchlist counts in one query ---
    watchlist_row = (
        db.query(
            func.count(case((Watchlist.content_type == "movie", 1))).label(
                "movies_watchlist"
            ),
            func.count(case((Watchlist.content_type == "tv", 1))).label(
                "shows_watchlist"
            ),
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

    # --- Rating distribution (1–5 buckets) ---
    rated_rows = (
        db.query(Watched.rating)
        .filter(Watched.user_id == user_id, Watched.rating.isnot(None))
        .all()
    )
    distribution: dict[int, int] = {}
    for (r,) in rated_rows:
        bucket = min(5, max(1, round(r)))
        distribution[bucket] = distribution.get(bucket, 0) + 1
    dist_list = [{"rating": i, "count": distribution.get(i, 0)} for i in range(1, 6)]

    # --- Top genres (movies + shows watched, single pass) ---
    movie_genre_rows = (
        db.query(Genre.name, func.count(Genre.id).label("cnt"))
        .join(MovieGenre, Genre.id == MovieGenre.genre_id)
        .join(
            Watched,
            and_(
                Watched.content_id == MovieGenre.movie_id,
                Watched.content_type == "movie",
                Watched.user_id == user_id,
            ),
        )
        .group_by(Genre.name)
        .all()
    )

    show_genre_rows = (
        db.query(Genre.name, func.count(Genre.id).label("cnt"))
        .join(ShowGenre, Genre.id == ShowGenre.genre_id)
        .join(
            Watched,
            and_(
                Watched.content_id == ShowGenre.show_id,
                Watched.content_type == "tv",
                Watched.user_id == user_id,
            ),
        )
        .group_by(Genre.name)
        .all()
    )

    genre_counts: dict[str, int] = {}
    for name, cnt in movie_genre_rows:
        genre_counts[name] = genre_counts.get(name, 0) + cnt
    for name, cnt in show_genre_rows:
        genre_counts[name] = genre_counts.get(name, 0) + cnt

    top_genres = sorted(
        [{"name": k, "count": v} for k, v in genre_counts.items()],
        key=lambda x: x["count"],
        reverse=True,
    )[:8]

    movie_avg = watched_row.movie_avg
    show_avg = watched_row.show_avg

    return {
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
    }
