# app/services/stats_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.show import Show
from app.models.genre import Genre, MovieGenre, ShowGenre


def get_user_stats(db: Session, user_id: str) -> dict:
    # --- Counts ---
    movies_watched = (
        db.query(func.count(Watched.id))
        .filter(Watched.user_id == user_id, Watched.content_type == "movie")
        .scalar()
        or 0
    )
    shows_watched = (
        db.query(func.count(Watched.id))
        .filter(Watched.user_id == user_id, Watched.content_type == "tv")
        .scalar()
        or 0
    )
    episodes_watched = (
        db.query(func.count(EpisodeWatched.id))
        .filter(EpisodeWatched.user_id == user_id)
        .scalar()
        or 0
    )
    movies_watchlist = (
        db.query(func.count(Watchlist.id))
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "movie")
        .scalar()
        or 0
    )
    shows_watchlist = (
        db.query(func.count(Watchlist.id))
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "tv")
        .scalar()
        or 0
    )

    # --- Average ratings ---
    movie_avg = (
        db.query(func.avg(Watched.rating))
        .filter(
            Watched.user_id == user_id,
            Watched.content_type == "movie",
            Watched.rating.isnot(None),
        )
        .scalar()
    )
    show_avg = (
        db.query(func.avg(Watched.rating))
        .filter(
            Watched.user_id == user_id,
            Watched.content_type == "tv",
            Watched.rating.isnot(None),
        )
        .scalar()
    )

    # --- Rating distribution (1–5 buckets, all content) ---
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

    # --- Top genres (movies watched) ---
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

    # --- Top genres (shows watched) ---
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

    return {
        "counts": {
            "movies_watched": movies_watched,
            "shows_watched": shows_watched,
            "episodes_watched": episodes_watched,
            "movies_watchlist": movies_watchlist,
            "shows_watchlist": shows_watchlist,
        },
        "ratings": {
            "movie_avg": round(movie_avg, 1) if movie_avg is not None else None,
            "show_avg": round(show_avg, 1) if show_avg is not None else None,
            "distribution": dist_list,
        },
        "top_genres": top_genres,
    }
