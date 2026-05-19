import random
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


# (min_minutes_needed, "you could have ___" phrase)
_HUMOR_FACTS = [
    # Enormous (weeks+)
    (302400, "walked the entire length of the Great Wall of China"),
    (288000, "walked from New York to Los Angeles on foot"),
    (237600, "thru-hiked the entire Appalachian Trail"),
    (216000, "sailed solo around the globe"),
    (172800, "hiked the Pacific Crest Trail end to end"),
    (100800, "cycled from London to Shanghai"),
    (86400, "driven Route 66 round-trip four times"),
    (72000, "read every Shakespeare play and sonnet — twice"),
    (60000, "learned piano to a Grade 8 level from scratch"),
    (57600, "watched every episode of Grey's Anatomy"),
    (50400, "walked the Camino de Santiago three times over"),
    (48000, "learned conversational Mandarin"),
    (43200, "read the entire A Song of Ice and Fire series"),
    (36000, "learned conversational Spanish"),
    (30000, "built a wooden canoe from scratch"),
    (28800, "watched every episode of Law & Order"),
    (25200, "watched every episode of Doctor Who"),
    (24000, "baked 200 loaves of bread from scratch"),
    (21600, "read the complete works of Charles Dickens"),
    (21000, "trained for and finished an ultramarathon"),
    (20160, "crossed the Atlantic Ocean by sailboat"),
    (18300, "watched the entire MCU catalog 10 times over"),
    (18000, "trained for a full marathon from couch to finish line"),
    (17280, "watched every episode of The Simpsons"),
    # Large (days)
    (14400, "driven across every US state"),
    (12960, "climbed Mount Everest"),
    (10800, "read the entire Harry Potter series — twice"),
    (9000, "completed a cross-country road trip through Europe"),
    (8640, "hiked the Tour du Mont Blanc loop six times"),
    (7200, "read the entire Harry Potter series cover to cover"),
    (6480, "learned to surf to an intermediate level"),
    (5940, "watched every episode of The Office US"),
    (5760, "watched every episode of Friends"),
    (5400, "binged all of Breaking Bad and Better Call Saul"),
    (4800, "read the complete Wheel of Time series"),
    (4200, "watched all eight seasons of Game of Thrones"),
    (3720, "binged Breaking Bad from pilot to finale"),
    (3600, "read War and Peace twice over"),
    (3240, "watched all of The Wire and The Sopranos"),
    # Medium (hours)
    (3000, "driven coast-to-coast across the United States"),
    (2940, "watched every Marvel Cinematic Universe film"),
    (2700, "learned the basics of a new language on Duolingo"),
    (2400, "driven from LA to New York non-stop"),
    (2160, "read the complete Dune series"),
    (1980, "watched every Christopher Nolan film back-to-back"),
    (1800, "binge-watched all of Stranger Things"),
    (1680, "completed a full woodworking beginner course"),
    (1560, "read the entire Lord of the Rings trilogy"),
    (1440, "watched every Studio Ghibli film twice over"),
    (1380, "binged all of Severance and Black Mirror"),
    (1320, "played through the entire Zelda timeline"),
    (1260, "read Moby Dick cover to cover"),
    (1200, "learned to juggle three balls"),
    (1080, "watched all Star Wars and Indiana Jones films"),
    (1020, "completed a beginner guitar course"),
    (960, "watched every Pixar film ever made"),
    (900, "built a LEGO Millennium Falcon from scratch"),
    (840, "binge-watched the entirety of Chernobyl and Band of Brothers"),
    (780, "cycled the length of Manhattan about 40 times"),
    (720, "read Anna Karenina"),
    (686, "watched the extended Lord of the Rings trilogy"),
    (660, "listened to every Beatles album ever recorded"),
    (600, "read War and Peace cover to cover"),
    (540, "watched The Godfather trilogy back-to-back"),
    (480, "watched every Best Picture Oscar winner from the last 30 years"),
    (420, "driven from LA to San Francisco and back"),
    (360, "read The Great Gatsby twice"),
    (300, "cooked a full Thanksgiving dinner from scratch"),
    (270, "watched every episode of The Bear"),
    (240, "run a full marathon"),
    (210, "done a complete yoga retreat day"),
    (180, "read The Great Gatsby"),
    (150, "made fresh croissants from scratch three times"),
    (120, "made homemade pasta and tiramisu from scratch"),
    (90, "taken a NASA-recommended perfect power nap"),
    (60, "run a 10K at a comfortable pace"),
    (45, "practiced mindfulness meditation for a full session"),
    (30, "done a complete HIIT workout"),
]


def _humor_fact(total_minutes: int) -> str:
    eligible = [(mins, phrase) for mins, phrase in _HUMOR_FACTS if total_minutes >= mins]
    if not eligible:
        hours = total_minutes // 60
        if hours >= 24:
            return f"you could have slept for {hours // 24} full day{'s' if hours // 24 != 1 else ''}"
        return f"you could have watched {max(1, total_minutes // 90)} movies back-to-back"
    threshold, phrase = random.choice(eligible)
    times = total_minutes // threshold
    suffix = f" {times:,} time{'s' if times != 1 else ''}" if times <= 50 else f" over {times:,} times"
    return f"you could have {phrase}{suffix}"


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
