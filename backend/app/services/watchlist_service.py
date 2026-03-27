# app/services/watchlist_service.py
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_
from datetime import datetime
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.show import Show
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.genre import Genre, ShowGenre, MovieGenre
from app.models.provider import Provider, ShowProvider, MovieProvider
from app.models.season import Season
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.episode_service import maybe_sync_show_episodes
from app.services.activity_service import log_activity
from functools import lru_cache


# -------------------------
# Serialization helpers
# -------------------------

def serialize_providers(junction_rows):
    """
    Convert ShowProvider/MovieProvider rows into the
    {flatrate: [...], rent: [...], buy: [...]} shape the frontend expects.
    """
    result = {}
    for row in junction_rows:
        p = row.provider
        entry = {
            "provider_id": p.id,
            "provider_name": p.name,
            "logo_path": p.logo_path,
        }
        if row.flatrate:
            result.setdefault("flatrate", []).append(entry)
        if row.rent:
            result.setdefault("rent", []).append(entry)
        if row.buy:
            result.setdefault("buy", []).append(entry)
    return result or None


def serialize_season(s):
    return {
        "id": s.id,
        "season_number": s.season_number,
        "name": s.name,
        "overview": s.overview,
        "air_date": str(s.air_date) if s.air_date else None,
        "episode_count": s.episode_count,
        "poster_path": s.poster_path,
        "vote_average": s.vote_average,
    }


def serialize_show(show):
    return {
        "id": show.id,
        "name": show.name,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "first_air_date": show.first_air_date,
        "last_air_date": show.last_air_date,
        "homepage": show.homepage,
        "in_production": show.in_production,
        "number_of_seasons": show.number_of_seasons,
        "number_of_episodes": show.number_of_episodes,
        "overview": show.overview,
        "poster_path": show.poster_path,
        "status": show.status,
        "tagline": show.tagline,
        "type": show.type,
        "tracking_count": show.tracking_count,
        "seasons": [serialize_season(s) for s in show.seasons],
        "genres": [{"id": g.id, "name": g.name} for g in show.genres],
        "providers": serialize_providers(show.show_providers),
    }


def serialize_movie(movie):
    return {
        "id": movie.id,
        "imdb_id": movie.imdb_id,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "budget": movie.budget,
        "homepage": movie.homepage,
        "overview": movie.overview,
        "tagline": movie.tagline,
        "poster_path": movie.poster_path,
        "release_date": movie.release_date,
        "revenue": movie.revenue,
        "runtime": movie.runtime,
        "status": movie.status,
        "title": movie.title,
        "tracking_count": movie.tracking_count,
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
        "providers": serialize_providers(movie.movie_providers),
    }


# -------------------------
# Genre/provider/season upsert helpers
# -------------------------

def _upsert_genres_for_show(db: Session, show: Show, genres_data: list):
    for g in (genres_data or []):
        genre = db.query(Genre).filter_by(id=g["id"]).first()
        if not genre:
            genre = Genre(id=g["id"], name=g["name"])
            db.add(genre)
            db.flush()
        exists = db.query(ShowGenre).filter_by(show_id=show.id, genre_id=genre.id).first()
        if not exists:
            db.add(ShowGenre(show_id=show.id, genre_id=genre.id))


def _upsert_genres_for_movie(db: Session, movie: Movie, genres_data: list):
    for g in (genres_data or []):
        genre = db.query(Genre).filter_by(id=g["id"]).first()
        if not genre:
            genre = Genre(id=g["id"], name=g["name"])
            db.add(genre)
            db.flush()
        exists = db.query(MovieGenre).filter_by(movie_id=movie.id, genre_id=genre.id).first()
        if not exists:
            db.add(MovieGenre(movie_id=movie.id, genre_id=genre.id))


def _upsert_providers_for_show(db: Session, show: Show, us_providers: dict):
    """
    us_providers is the TMDB US provider dict:
    {"flatrate": [...], "rent": [...], "buy": [...]}
    Each provider appears once in the provider table; the junction row
    tracks which types (flatrate/rent/buy) it offers for this show.
    """
    provider_map = {}
    for ptype in ("flatrate", "rent", "buy"):
        for p in us_providers.get(ptype, []):
            pid = p["provider_id"]
            if pid not in provider_map:
                provider_map[pid] = {
                    "name": p["provider_name"],
                    "logo_path": p.get("logo_path"),
                    "flatrate": False,
                    "rent": False,
                    "buy": False,
                }
            provider_map[pid][ptype] = True

    for pid, data in provider_map.items():
        provider = db.query(Provider).filter_by(id=pid).first()
        if not provider:
            provider = Provider(id=pid, name=data["name"], logo_path=data["logo_path"])
            db.add(provider)
            db.flush()
        sp = db.query(ShowProvider).filter_by(show_id=show.id, provider_id=pid).first()
        if not sp:
            db.add(ShowProvider(
                show_id=show.id,
                provider_id=pid,
                flatrate=data["flatrate"],
                rent=data["rent"],
                buy=data["buy"],
            ))
        else:
            sp.flatrate = data["flatrate"]
            sp.rent = data["rent"]
            sp.buy = data["buy"]


def _upsert_providers_for_movie(db: Session, movie: Movie, us_providers: dict):
    provider_map = {}
    for ptype in ("flatrate", "rent", "buy"):
        for p in us_providers.get(ptype, []):
            pid = p["provider_id"]
            if pid not in provider_map:
                provider_map[pid] = {
                    "name": p["provider_name"],
                    "logo_path": p.get("logo_path"),
                    "flatrate": False,
                    "rent": False,
                    "buy": False,
                }
            provider_map[pid][ptype] = True

    for pid, data in provider_map.items():
        provider = db.query(Provider).filter_by(id=pid).first()
        if not provider:
            provider = Provider(id=pid, name=data["name"], logo_path=data["logo_path"])
            db.add(provider)
            db.flush()
        mp = db.query(MovieProvider).filter_by(movie_id=movie.id, provider_id=pid).first()
        if not mp:
            db.add(MovieProvider(
                movie_id=movie.id,
                provider_id=pid,
                flatrate=data["flatrate"],
                rent=data["rent"],
                buy=data["buy"],
            ))
        else:
            mp.flatrate = data["flatrate"]
            mp.rent = data["rent"]
            mp.buy = data["buy"]


def _upsert_seasons_for_show(db: Session, show: Show, seasons_data: list):
    for s in (seasons_data or []):
        sid = s.get("id")
        if not sid:
            continue
        season = db.query(Season).filter_by(id=sid).first()
        if not season:
            db.add(Season(
                id=sid,
                show_id=show.id,
                season_number=s["season_number"],
                name=s.get("name"),
                overview=s.get("overview"),
                air_date=s.get("air_date") or None,
                episode_count=s.get("episode_count"),
                poster_path=s.get("poster_path"),
                vote_average=s.get("vote_average"),
            ))
        else:
            # Update mutable fields (episode count can change as show airs)
            season.episode_count = s.get("episode_count")
            season.vote_average = s.get("vote_average")


# -------------------------
# Release date helper
# -------------------------

def get_theatrical_release_date(movie_data: dict) -> str | None:
    results = movie_data.get("release_dates", {}).get("results", [])

    us_entry = next(
        (r for r in results if r.get("iso_3166_1") == "US"),
        None,
    )

    if not us_entry:
        return None

    # Prefer theatrical > limited > premiere
    for release_type in (3, 2, 1):
        for rd in us_entry.get("release_dates", []):
            if rd.get("type") == release_type:
                return rd.get("release_date")

    return None


# -------------------------
# Watchlist operations
# -------------------------

def add_to_watchlist(db: Session, user_id: str, content_type: str, content_id: int):
    """
    Add a movie or show to the user's watchlist.
    """
    existing = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if existing:
        return existing

    entry = Watchlist(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        added_at=datetime.utcnow(),
    )
    db.add(entry)

    if content_type == "movie":
        movie = db.query(Movie).filter_by(id=content_id).first()
        if movie:
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
                logo_path=logo,
                tracking_count=1,
            )
            db.add(movie)
            db.flush()
            _upsert_genres_for_movie(db, movie, movie_data.get("genres", []))
            _upsert_providers_for_movie(db, movie, us_providers)

    elif content_type == "tv":
        show = db.query(Show).filter_by(id=content_id).first()
        if show:
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
                logo_path=logo,
                tracking_count=1,
            )
            db.add(show)
            db.flush()
            _upsert_genres_for_show(db, show, show_data.get("genres", []))
            _upsert_providers_for_show(db, show, us_providers)
            _upsert_seasons_for_show(db, show, show_data.get("seasons", []))

    # Log activity before committing
    if content_type == "movie":
        item = db.query(Movie).filter_by(id=content_id).first()
        log_activity(db, user_id, "want_to_watch", content_type, content_id,
                     item.title if item else None, item.poster_path if item else None)
    elif content_type == "tv":
        item = db.query(Show).filter_by(id=content_id).first()
        log_activity(db, user_id, "want_to_watch", content_type, content_id,
                     item.name if item else None, item.poster_path if item else None)

    db.commit()
    db.refresh(entry)

    if content_type == "tv":
        maybe_sync_show_episodes(db, content_id)

    return entry


def remove_from_watchlist(
    db: Session, user_id: str, content_type: str, content_id: int
):
    """
    Remove a movie or show from the user's watchlist.
    """
    entry = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )

    if not entry:
        return {"message": "Item not found in watchlist"}

    db.delete(entry)

    if content_type == "movie":
        movie = db.query(Movie).filter_by(id=content_id).first()
        if movie:
            movie.tracking_count -= 1
            watched_exists = (
                db.query(Watched)
                .filter_by(content_id=content_id, content_type="movie")
                .first()
            )

        if movie.tracking_count <= 0 and not watched_exists:
            db.delete(movie)
    elif content_type == "tv":
        show = db.query(Show).filter_by(id=content_id).first()
        if show:
            show.tracking_count -= 1
            watched_exists = (
                db.query(Watched)
                .filter_by(content_id=content_id, content_type="tv")
                .first()
            )

        if show.tracking_count <= 0 and not watched_exists:
            db.query(EpisodeWatched).filter_by(show_id=content_id).delete()
            db.query(Episode).filter_by(show_id=content_id).delete()
            db.delete(show)

    db.commit()
    return {"message": "Removed from watchlist"}


def _show_query_options():
    """Shared selectinload options for loading show relationships."""
    return [
        selectinload(Show.seasons),
        selectinload(Show.genres),
        selectinload(Show.show_providers).selectinload(ShowProvider.provider),
    ]


def _movie_query_options():
    """Shared selectinload options for loading movie relationships."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers).selectinload(MovieProvider.provider),
    ]


@lru_cache(maxsize=1024)
def get_watchlist(db: Session, user_id: str):
    movies = get_movie_watchlist_info(db, user_id)
    shows = get_tv_watchlist_info(db, user_id)
    return {"movies": movies, "shows": shows}


@lru_cache(maxsize=1024)
def get_tv_watchlist_info(db: Session, user_id: str):
    items = (
        db.query(Show)
        .options(*_show_query_options())
        .select_from(Watchlist)
        .join(
            Show,
            and_(
                Watchlist.content_id == Show.id,
                Watchlist.content_type == "tv",
                Watchlist.user_id == user_id,
            ),
        )
        .all()
    )
    return [serialize_show(show) for show in items]


@lru_cache(maxsize=1024)
def get_movie_watchlist_info(db: Session, user_id: str):
    items = (
        db.query(Movie)
        .options(*_movie_query_options())
        .select_from(Watchlist)
        .join(
            Movie,
            and_(
                Watchlist.content_id == Movie.id,
                Watchlist.content_type == "movie",
                Watchlist.user_id == user_id,
            ),
        )
        .all()
    )
    return [serialize_movie(movie) for movie in items]


@lru_cache(maxsize=1024)
def get_movie_watchlist_status(id: int, db: Session, user_id: str):
    entry = (
        db.query(CurrentlyWatching)
        .filter_by(content_id=id, user_id=user_id, content_type="movie")
        .first()
    )
    if entry:
        return {"status": "Currently Watching"}

    entry = (
        db.query(Watchlist)
        .filter_by(content_id=id, user_id=user_id, content_type="movie")
        .first()
    )
    if entry:
        return {"status": "Want To Watch"}

    entry = (
        db.query(Watched)
        .filter_by(content_id=id, user_id=user_id, content_type="movie")
        .first()
    )
    if entry:
        return {"status": "Watched", "rating": entry.rating}

    return {"status": "none"}


@lru_cache(maxsize=1024)
def get_show_watchlist_status(id: int, db: Session, user_id: str):
    entry = (
        db.query(CurrentlyWatching)
        .filter_by(content_id=id, user_id=user_id, content_type="tv")
        .first()
    )
    if entry:
        return {"status": "Currently Watching"}

    entry = (
        db.query(Watchlist)
        .filter_by(content_id=id, user_id=user_id, content_type="tv")
        .first()
    )
    if entry:
        return {"status": "Want To Watch"}

    entry = (
        db.query(Watched)
        .filter_by(content_id=id, user_id=user_id, content_type="tv")
        .first()
    )
    if entry:
        return {"status": "Watched", "rating": entry.rating}

    return {"status": "none"}
