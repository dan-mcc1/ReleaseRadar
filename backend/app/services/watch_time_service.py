# app/services/watch_time_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract
from app.models.watched import Watched
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.show import Show
from app.models.episode import Episode
from app.models.genre import Genre, MovieGenre, ShowGenre
from app.models.provider import Provider, ShowProvider, MovieProvider
from datetime import datetime, timezone


_HUMOR_FACTS = [
    ("climbed Mount Everest", 9, "days"),
    ("driven across the US coast-to-coast", 40, "hours"),
    ("watched the entire Lord of the Rings extended trilogy", 686, "minutes"),
    ("read War and Peace twice", 60, "hours"),
    ("baked 200 loaves of bread", 400, "hours"),
    ("learned conversational Spanish", 600, "hours"),
    ("completed a solo sailing circumnavigation", 60, "days"),
    ("trained for a marathon", 300, "hours"),
    ("watched the entire MCU 10 times over", 305, "hours"),
]


def _humor_fact(total_minutes: int) -> str:
    for label, amount, unit in _HUMOR_FACTS:
        if unit == "minutes" and total_minutes >= amount:
            times = total_minutes // amount
            return f"you could have watched '{label}' {times} time{'s' if times != 1 else ''}"
        if unit == "hours" and total_minutes >= amount * 60:
            times = total_minutes // (amount * 60)
            return f"you could have {label} {times} time{'s' if times != 1 else ''}"
        if unit == "days" and total_minutes >= amount * 1440:
            times = total_minutes // (amount * 1440)
            return f"you could have {label} {times} time{'s' if times != 1 else ''}"
    hours = total_minutes // 60
    if hours >= 24:
        return f"you could have slept for {hours // 24} full day{'s' if hours // 24 != 1 else ''}"
    return f"you could have watched {total_minutes // 90} movies back-to-back"


def get_watch_time_stats(db: Session, user_id: str, year: int | None = None) -> dict:
    # ── Movie runtime ──────────────────────────────────────────────────────────
    movie_q = (
        db.query(func.coalesce(func.sum(Movie.runtime), 0))
        .join(Watched, and_(Watched.content_id == Movie.id, Watched.content_type == "movie"))
        .filter(Watched.user_id == user_id, Movie.runtime.isnot(None))
    )
    if year:
        movie_q = movie_q.filter(extract("year", Watched.watched_at) == year)
    movie_minutes: int = movie_q.scalar() or 0

    # ── Episode runtime ────────────────────────────────────────────────────────
    ep_q = (
        db.query(func.coalesce(func.sum(Episode.runtime), 0))
        .join(EpisodeWatched, EpisodeWatched.episode_id == Episode.id)
        .filter(EpisodeWatched.user_id == user_id, Episode.runtime.isnot(None))
    )
    if year:
        ep_q = ep_q.filter(extract("year", EpisodeWatched.watched_at) == year)
    ep_minutes: int = ep_q.scalar() or 0

    total_minutes = movie_minutes + ep_minutes

    # ── Counts ─────────────────────────────────────────────────────────────────
    movies_q = db.query(func.count(Watched.id)).filter(
        Watched.user_id == user_id, Watched.content_type == "movie"
    )
    if year:
        movies_q = movies_q.filter(extract("year", Watched.watched_at) == year)
    movies_count: int = movies_q.scalar() or 0

    eps_q = db.query(func.count(EpisodeWatched.id)).filter(EpisodeWatched.user_id == user_id)
    if year:
        eps_q = eps_q.filter(extract("year", EpisodeWatched.watched_at) == year)
    episodes_count: int = eps_q.scalar() or 0

    # ── Genre breakdown ────────────────────────────────────────────────────────
    movie_genre_rows = (
        db.query(Genre.name, func.coalesce(func.sum(Movie.runtime), 30).label("mins"))
        .join(MovieGenre, Genre.id == MovieGenre.genre_id)
        .join(Movie, Movie.id == MovieGenre.movie_id)
        .join(Watched, and_(Watched.content_id == Movie.id, Watched.content_type == "movie"))
        .filter(Watched.user_id == user_id)
        .group_by(Genre.name)
    )
    if year:
        movie_genre_rows = movie_genre_rows.filter(extract("year", Watched.watched_at) == year)

    show_genre_rows = (
        db.query(Genre.name, func.coalesce(func.sum(Episode.runtime), 30).label("mins"))
        .join(ShowGenre, Genre.id == ShowGenre.genre_id)
        .join(Show, Show.id == ShowGenre.show_id)
        .join(EpisodeWatched, EpisodeWatched.show_id == Show.id)
        .join(Episode, and_(
            Episode.show_id == EpisodeWatched.show_id,
            Episode.season_number == EpisodeWatched.season_number,
            Episode.episode_number == EpisodeWatched.episode_number,
        ))
        .filter(EpisodeWatched.user_id == user_id)
        .group_by(Genre.name)
    )
    if year:
        show_genre_rows = show_genre_rows.filter(extract("year", EpisodeWatched.watched_at) == year)

    genre_mins: dict[str, int] = {}
    for name, mins in movie_genre_rows.all():
        genre_mins[name] = genre_mins.get(name, 0) + int(mins)
    for name, mins in show_genre_rows.all():
        genre_mins[name] = genre_mins.get(name, 0) + int(mins)

    top_genres = sorted(
        [{"name": k, "minutes": v} for k, v in genre_mins.items()],
        key=lambda x: x["minutes"],
        reverse=True,
    )[:8]

    # ── Platform breakdown (flatrate providers only) ───────────────────────────
    movie_provider_rows = (
        db.query(Provider.name, Provider.logo_path,
                 func.coalesce(func.sum(Movie.runtime), 90).label("mins"))
        .join(MovieProvider, Provider.id == MovieProvider.provider_id)
        .join(Movie, Movie.id == MovieProvider.movie_id)
        .join(Watched, and_(Watched.content_id == Movie.id, Watched.content_type == "movie"))
        .filter(Watched.user_id == user_id, MovieProvider.flatrate == True)
        .group_by(Provider.id, Provider.name, Provider.logo_path)
    )
    if year:
        movie_provider_rows = movie_provider_rows.filter(extract("year", Watched.watched_at) == year)

    show_provider_rows = (
        db.query(Provider.name, Provider.logo_path,
                 func.coalesce(func.sum(Episode.runtime), 30).label("mins"))
        .join(ShowProvider, Provider.id == ShowProvider.provider_id)
        .join(Show, Show.id == ShowProvider.show_id)
        .join(EpisodeWatched, EpisodeWatched.show_id == Show.id)
        .join(Episode, and_(
            Episode.show_id == EpisodeWatched.show_id,
            Episode.season_number == EpisodeWatched.season_number,
            Episode.episode_number == EpisodeWatched.episode_number,
        ))
        .filter(EpisodeWatched.user_id == user_id, ShowProvider.flatrate == True)
        .group_by(Provider.id, Provider.name, Provider.logo_path)
    )
    if year:
        show_provider_rows = show_provider_rows.filter(extract("year", EpisodeWatched.watched_at) == year)

    platform_data: dict[str, dict] = {}
    for name, logo, mins in movie_provider_rows.all():
        if name not in platform_data:
            platform_data[name] = {"name": name, "logo_path": logo, "minutes": 0}
        platform_data[name]["minutes"] += int(mins)
    for name, logo, mins in show_provider_rows.all():
        if name not in platform_data:
            platform_data[name] = {"name": name, "logo_path": logo, "minutes": 0}
        platform_data[name]["minutes"] += int(mins)

    top_platforms = sorted(
        list(platform_data.values()),
        key=lambda x: x["minutes"],
        reverse=True,
    )[:5]

    # ── Longest single-day binge ───────────────────────────────────────────────
    binge_q = (
        db.query(
            func.date(EpisodeWatched.watched_at).label("day"),
            func.coalesce(func.sum(Episode.runtime), 0).label("day_mins"),
        )
        .join(Episode, and_(
            Episode.show_id == EpisodeWatched.show_id,
            Episode.season_number == EpisodeWatched.season_number,
            Episode.episode_number == EpisodeWatched.episode_number,
        ))
        .filter(EpisodeWatched.user_id == user_id, Episode.runtime.isnot(None))
    )
    if year:
        binge_q = binge_q.filter(extract("year", EpisodeWatched.watched_at) == year)
    binge_q = (
        binge_q
        .group_by(func.date(EpisodeWatched.watched_at))
        .order_by(func.coalesce(func.sum(Episode.runtime), 0).desc())
        .limit(1)
    )
    binge_row = binge_q.first()
    longest_binge = {
        "date": str(binge_row.day) if binge_row else None,
        "minutes": int(binge_row.day_mins) if binge_row else 0,
    }

    # ── Available years (for year picker) ─────────────────────────────────────
    movie_years = db.query(
        func.extract("year", Watched.watched_at).label("yr")
    ).filter(Watched.user_id == user_id, Watched.content_type == "movie").distinct()

    ep_years = db.query(
        func.extract("year", EpisodeWatched.watched_at).label("yr")
    ).filter(EpisodeWatched.user_id == user_id).distinct()

    all_years = sorted(
        {int(r.yr) for r in movie_years.all() if r.yr}
        | {int(r.yr) for r in ep_years.all() if r.yr},
        reverse=True,
    )

    humor = _humor_fact(total_minutes) if total_minutes > 0 else None

    return {
        "year": year,
        "available_years": all_years,
        "total_minutes": total_minutes,
        "movie_minutes": movie_minutes,
        "episode_minutes": ep_minutes,
        "movies_count": movies_count,
        "episodes_count": episodes_count,
        "top_genres": top_genres,
        "top_platforms": top_platforms,
        "longest_binge": longest_binge,
        "humor_fact": humor,
    }
