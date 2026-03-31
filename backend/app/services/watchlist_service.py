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
from app.services.episode_service import sync_show_episodes_background
from app.services.activity_service import log_activity
from app.services.tvmaze_service import fetch_show_air_time
from sqlalchemy import text
from collections import defaultdict


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
        "air_time": show.air_time,
        "air_timezone": show.air_timezone,
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
    if not genres_data:
        return
    genre_ids = [g["id"] for g in genres_data]
    existing_genres = {g.id: g for g in db.query(Genre).filter(Genre.id.in_(genre_ids)).all()}
    existing_links = {
        sg.genre_id
        for sg in db.query(ShowGenre).filter_by(show_id=show.id).filter(ShowGenre.genre_id.in_(genre_ids)).all()
    }
    for g in genres_data:
        if g["id"] not in existing_genres:
            db.add(Genre(id=g["id"], name=g["name"]))
        if g["id"] not in existing_links:
            db.add(ShowGenre(show_id=show.id, genre_id=g["id"]))


def _upsert_genres_for_movie(db: Session, movie: Movie, genres_data: list):
    if not genres_data:
        return
    genre_ids = [g["id"] for g in genres_data]
    existing_genres = {g.id: g for g in db.query(Genre).filter(Genre.id.in_(genre_ids)).all()}
    existing_links = {
        mg.genre_id
        for mg in db.query(MovieGenre).filter_by(movie_id=movie.id).filter(MovieGenre.genre_id.in_(genre_ids)).all()
    }
    for g in genres_data:
        if g["id"] not in existing_genres:
            db.add(Genre(id=g["id"], name=g["name"]))
        if g["id"] not in existing_links:
            db.add(MovieGenre(movie_id=movie.id, genre_id=g["id"]))


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

    if not provider_map:
        return
    pids = list(provider_map.keys())
    existing_providers = {p.id for p in db.query(Provider).filter(Provider.id.in_(pids)).all()}
    existing_show_providers = {
        sp.provider_id: sp
        for sp in db.query(ShowProvider).filter_by(show_id=show.id).filter(ShowProvider.provider_id.in_(pids)).all()
    }
    for pid, data in provider_map.items():
        if pid not in existing_providers:
            db.add(Provider(id=pid, name=data["name"], logo_path=data["logo_path"]))
        sp = existing_show_providers.get(pid)
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

    if not provider_map:
        return
    pids = list(provider_map.keys())
    existing_providers = {p.id for p in db.query(Provider).filter(Provider.id.in_(pids)).all()}
    existing_movie_providers = {
        mp.provider_id: mp
        for mp in db.query(MovieProvider).filter_by(movie_id=movie.id).filter(MovieProvider.provider_id.in_(pids)).all()
    }
    for pid, data in provider_map.items():
        if pid not in existing_providers:
            db.add(Provider(id=pid, name=data["name"], logo_path=data["logo_path"]))
        mp = existing_movie_providers.get(pid)
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
    if not seasons_data:
        return
    season_ids = [s.get("id") for s in seasons_data if s.get("id")]
    existing_seasons = {
        s.id: s for s in db.query(Season).filter(Season.id.in_(season_ids)).all()
    }
    for s in seasons_data:
        sid = s.get("id")
        if not sid:
            continue
        season = existing_seasons.get(sid)
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

    if us_entry:
        # Prefer theatrical (3) > limited (2) > premiere (1) > digital (4)
        for release_type in (3, 2, 1, 4):
            for rd in us_entry.get("release_dates", []):
                if rd.get("type") == release_type:
                    raw = rd.get("release_date", "")
                    return raw[:10] if raw else None

    # Fall back to TMDB's top-level release_date (always present)
    return movie_data.get("release_date") or None


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

    # Only increment tracking_count if not already on any other list
    already_tracked = (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None or (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None

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
            if not already_tracked:
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
            if not already_tracked:
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
            air_time, air_timezone = fetch_show_air_time(show_data["name"])
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
                air_time=air_time,
                air_timezone=air_timezone,
            )
            db.add(show)
            db.flush()
            _upsert_genres_for_show(db, show, show_data.get("genres", []))
            _upsert_providers_for_show(db, show, us_providers)
            _upsert_seasons_for_show(db, show, show_data.get("seasons", []))

    # Log activity before committing — reuse already-fetched objects
    if content_type == "movie":
        log_activity(db, user_id, "want_to_watch", content_type, content_id,
                     movie.title if movie else None, movie.poster_path if movie else None)
    elif content_type == "tv":
        log_activity(db, user_id, "want_to_watch", content_type, content_id,
                     show.name if show else None, show.poster_path if show else None)

    db.commit()
    db.refresh(entry)

    if content_type == "tv":
        sync_show_episodes_background(content_id)

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

    # Only decrement tracking_count if not still on any other list
    still_tracked = (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None or (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None

    if content_type == "movie":
        movie = db.query(Movie).filter_by(id=content_id).first()
        if movie and not still_tracked:
            movie.tracking_count -= 1
            if movie.tracking_count <= 0:
                db.delete(movie)
    elif content_type == "tv":
        show = db.query(Show).filter_by(id=content_id).first()
        if show and not still_tracked:
            show.tracking_count -= 1
            if show.tracking_count <= 0:
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


def get_watchlist(db: Session, user_id: str):
    movies = get_movie_watchlist_info(db, user_id)
    shows = get_tv_watchlist_info(db, user_id)
    return {"movies": movies, "shows": shows}


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


def get_movie_watchlist_status(id: int, db: Session, user_id: str):
    row = db.execute(text("""
        SELECT 'Currently Watching' AS status, NULL::float AS rating
        FROM currently_watching
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'movie'
        UNION ALL
        SELECT 'Want To Watch', NULL
        FROM watchlist
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'movie'
        UNION ALL
        SELECT 'Watched', rating
        FROM watched
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'movie'
        LIMIT 1
    """), {"uid": user_id, "cid": id}).first()

    if not row:
        return {"status": "none"}
    if row.status == "Watched":
        return {"status": "Watched", "rating": row.rating}
    return {"status": row.status}


def get_show_watchlist_status(id: int, db: Session, user_id: str):
    row = db.execute(text("""
        SELECT 'Currently Watching' AS status, NULL::float AS rating
        FROM currently_watching
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'tv'
        UNION ALL
        SELECT 'Want To Watch', NULL
        FROM watchlist
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'tv'
        UNION ALL
        SELECT 'Watched', rating
        FROM watched
        WHERE user_id = :uid AND content_id = :cid AND content_type = 'tv'
        LIMIT 1
    """), {"uid": user_id, "cid": id}).first()

    if not row:
        return {"status": "none"}
    if row.status == "Watched":
        return {"status": "Watched", "rating": row.rating}
    return {"status": row.status}


def get_tv_calendar(db: Session, user_id: str):
    """
    Return all TV shows in the user's watchlist + currently-watching list
    with all their episodes. 3 DB queries regardless of how many shows.
    """
    # 1. Collect show IDs from both tables
    watchlist_ids = {
        row.content_id
        for row in db.query(Watchlist.content_id)
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "tv")
        .all()
    }
    cw_ids = {
        row.content_id
        for row in db.query(CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id, CurrentlyWatching.content_type == "tv")
        .all()
    }
    show_ids = list(watchlist_ids | cw_ids)

    if not show_ids:
        return []

    # 2. Load show metadata + relationships
    shows = (
        db.query(Show)
        .options(*_show_query_options())
        .filter(Show.id.in_(show_ids))
        .all()
    )

    # 3. Load all episodes for every show in one query
    episodes = (
        db.query(Episode)
        .filter(Episode.show_id.in_(show_ids))
        .order_by(Episode.show_id, Episode.season_number, Episode.episode_number)
        .all()
    )

    eps_by_show: dict[int, list] = defaultdict(list)
    for ep in episodes:
        eps_by_show[ep.show_id].append({
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
        })

    return [
        {"show": serialize_show(show), "episodes": eps_by_show[show.id]}
        for show in shows
    ]
