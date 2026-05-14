from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract, union
from app.models.watched import Watched
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.show import Show
from app.models.episode import Episode
from app.models.genre import Genre, MovieGenre, ShowGenre
from app.models.provider import Provider, ShowProvider, MovieProvider
from app.db.session import SessionLocal


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
    def _with_session(fn):
        s = SessionLocal()
        try:
            return fn(s)
        finally:
            s.close()

    # Combined count + runtime for movies in one query
    def _movie_stats(s):
        q = (
            s.query(
                func.count(Watched.id).label("cnt"),
                func.coalesce(func.sum(Movie.runtime), 0).label("mins"),
            )
            .outerjoin(Movie, Watched.content_id == Movie.id)
            .filter(Watched.user_id == user_id, Watched.content_type == "movie")
        )
        if year:
            q = q.filter(extract("year", Watched.watched_at) == year)
        row = q.one()
        return int(row.cnt), int(row.mins)

    # Combined count + runtime for episodes in one query
    def _ep_stats(s):
        q = (
            s.query(
                func.count(EpisodeWatched.id).label("cnt"),
                func.coalesce(func.sum(Episode.runtime), 0).label("mins"),
            )
            .outerjoin(Episode, and_(
                Episode.show_id == EpisodeWatched.show_id,
                Episode.season_number == EpisodeWatched.season_number,
                Episode.episode_number == EpisodeWatched.episode_number,
            ))
            .filter(EpisodeWatched.user_id == user_id)
        )
        if year:
            q = q.filter(extract("year", EpisodeWatched.watched_at) == year)
        row = q.one()
        return int(row.cnt), int(row.mins)

    def _movie_genres(s):
        q = (
            s.query(Genre.name, func.coalesce(func.sum(Movie.runtime), 30).label("mins"))
            .join(MovieGenre, Genre.id == MovieGenre.genre_id)
            .join(Movie, Movie.id == MovieGenre.movie_id)
            .join(Watched, and_(Watched.content_id == Movie.id, Watched.content_type == "movie"))
            .filter(Watched.user_id == user_id)
            .group_by(Genre.name)
        )
        if year:
            q = q.filter(extract("year", Watched.watched_at) == year)
        return q.all()

    def _show_genres(s):
        q = (
            s.query(Genre.name, func.coalesce(func.sum(Episode.runtime), 30).label("mins"))
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
            q = q.filter(extract("year", EpisodeWatched.watched_at) == year)
        return q.all()

    def _movie_providers(s):
        q = (
            s.query(
                Provider.name, Provider.logo_path,
                func.coalesce(func.sum(Movie.runtime), 90).label("mins"),
            )
            .join(MovieProvider, Provider.id == MovieProvider.provider_id)
            .join(Movie, Movie.id == MovieProvider.movie_id)
            .join(Watched, and_(Watched.content_id == Movie.id, Watched.content_type == "movie"))
            .filter(Watched.user_id == user_id, MovieProvider.flatrate == True)
            .group_by(Provider.id, Provider.name, Provider.logo_path)
        )
        if year:
            q = q.filter(extract("year", Watched.watched_at) == year)
        return q.all()

    def _show_providers(s):
        q = (
            s.query(
                Provider.name, Provider.logo_path,
                func.coalesce(func.sum(Episode.runtime), 30).label("mins"),
            )
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
            q = q.filter(extract("year", EpisodeWatched.watched_at) == year)
        return q.all()

    def _binge(s):
        q = (
            s.query(
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
            q = q.filter(extract("year", EpisodeWatched.watched_at) == year)
        row = (
            q.group_by(func.date(EpisodeWatched.watched_at))
            .order_by(func.coalesce(func.sum(Episode.runtime), 0).desc())
            .limit(1)
            .first()
        )
        return {
            "date": str(row.day) if row else None,
            "minutes": int(row.day_mins) if row else 0,
        }

    # Union of movie + episode years in a single round-trip; runs on the
    # existing db session on the main thread while the 4 threads run in parallel.
    def _years(s):
        movie_yr = s.query(
            func.extract("year", Watched.watched_at).label("yr")
        ).filter(Watched.user_id == user_id, Watched.content_type == "movie").distinct()
        ep_yr = s.query(
            func.extract("year", EpisodeWatched.watched_at).label("yr")
        ).filter(EpisodeWatched.user_id == user_id).distinct()
        rows = s.execute(union(movie_yr, ep_yr)).fetchall()
        return sorted({int(r[0]) for r in rows if r[0]}, reverse=True)

    # All 7 queries fire in parallel; years runs on the main thread concurrently.
    with ThreadPoolExecutor(max_workers=7) as ex:
        f_movie = ex.submit(_with_session, _movie_stats)
        f_ep = ex.submit(_with_session, _ep_stats)
        f_movie_genres = ex.submit(_with_session, _movie_genres)
        f_show_genres = ex.submit(_with_session, _show_genres)
        f_movie_providers = ex.submit(_with_session, _movie_providers)
        f_show_providers = ex.submit(_with_session, _show_providers)
        f_binge = ex.submit(_with_session, _binge)
        all_years = _years(db)

    movies_count, movie_minutes = f_movie.result()
    episodes_count, ep_minutes = f_ep.result()
    longest_binge = f_binge.result()

    genre_mins: dict[str, int] = {}
    for name, mins in f_movie_genres.result():
        genre_mins[name] = genre_mins.get(name, 0) + int(mins)
    for name, mins in f_show_genres.result():
        genre_mins[name] = genre_mins.get(name, 0) + int(mins)
    top_genres = sorted(
        [{"name": k, "minutes": v} for k, v in genre_mins.items()],
        key=lambda x: x["minutes"],
        reverse=True,
    )[:8]

    platform_data: dict[str, dict] = {}
    for name, logo, mins in f_movie_providers.result():
        if name not in platform_data:
            platform_data[name] = {"name": name, "logo_path": logo, "minutes": 0}
        platform_data[name]["minutes"] += int(mins)
    for name, logo, mins in f_show_providers.result():
        if name not in platform_data:
            platform_data[name] = {"name": name, "logo_path": logo, "minutes": 0}
        platform_data[name]["minutes"] += int(mins)
    top_platforms = sorted(platform_data.values(), key=lambda x: x["minutes"], reverse=True)[:5]

    total_minutes = movie_minutes + ep_minutes
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
