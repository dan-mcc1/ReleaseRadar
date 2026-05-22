# app/services/media_upsert.py
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from app.models.movie import Movie
from app.models.show import Show
from app.models.genre import Genre, ShowGenre, MovieGenre
from app.models.provider import Provider, ShowProvider, MovieProvider
from app.models.season import Season
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.provider_utils import canonical_provider_id, canonical_provider_name
from app.services.tvmaze_service import fetch_show_air_time
from app.db.session import SessionLocal


# -------------------------
# Genre/provider/season upsert helpers
# -------------------------


def _upsert_genres(db: Session, genres_data: list, link_model, **link_kwargs):
    if not genres_data:
        return
    genre_ids = [g["id"] for g in genres_data]
    existing_genres = {
        g.id: g for g in db.query(Genre).filter(Genre.id.in_(genre_ids)).all()
    }
    existing_links = {
        row.genre_id
        for row in db.query(link_model)
        .filter_by(**link_kwargs)
        .filter(link_model.genre_id.in_(genre_ids))
        .all()
    }
    for g in genres_data:
        if g["id"] not in existing_genres:
            db.add(Genre(id=g["id"], name=g["name"]))
        if g["id"] not in existing_links:
            db.add(link_model(genre_id=g["id"], **link_kwargs))


def _upsert_providers(db: Session, us_providers: dict, link_model, **link_kwargs):
    """
    us_providers is the TMDB US provider dict:
    {"flatrate": [...], "rent": [...], "buy": [...]}
    Provider variants are collapsed to their canonical ID before storing so the
    DB stays clean and the optimizer/watchlist filter always see canonical IDs.
    """
    provider_map: dict[int, dict] = {}
    for ptype in ("flatrate", "rent", "buy"):
        for p in us_providers.get(ptype, []):
            raw_pid = p["provider_id"]
            cpid = canonical_provider_id(raw_pid)
            if cpid not in provider_map:
                provider_map[cpid] = {
                    "name": canonical_provider_name(raw_pid, p["provider_name"]),
                    "logo_path": p.get("logo_path"),
                    "flatrate": False,
                    "rent": False,
                    "buy": False,
                }
            provider_map[cpid][ptype] = True

    if not provider_map:
        return
    pids = list(provider_map.keys())
    existing_providers = {
        p.id for p in db.query(Provider).filter(Provider.id.in_(pids)).all()
    }
    existing_links = {
        row.provider_id: row
        for row in db.query(link_model)
        .filter_by(**link_kwargs)
        .filter(link_model.provider_id.in_(pids))
        .all()
    }
    for pid, data in provider_map.items():
        if pid not in existing_providers:
            db.add(Provider(id=pid, name=data["name"], logo_path=data["logo_path"]))
        link = existing_links.get(pid)
        if not link:
            db.add(
                link_model(
                    provider_id=pid,
                    flatrate=data["flatrate"],
                    rent=data["rent"],
                    buy=data["buy"],
                    **link_kwargs,
                )
            )
        else:
            link.flatrate = data["flatrate"]
            link.rent = data["rent"]
            link.buy = data["buy"]


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
            db.add(
                Season(
                    id=sid,
                    show_id=show.id,
                    season_number=s["season_number"],
                    name=s.get("name"),
                    overview=s.get("overview"),
                    air_date=s.get("air_date") or None,
                    episode_count=s.get("episode_count"),
                    poster_path=s.get("poster_path"),
                    vote_average=s.get("vote_average"),
                )
            )
        else:
            season.episode_count = s.get("episode_count")
            season.vote_average = s.get("vote_average")


# -------------------------
# Release date / certification helpers
# -------------------------


def get_us_movie_certification(movie_data: dict) -> str | None:
    results = movie_data.get("release_dates", {}).get("results", [])
    us = next((r for r in results if r.get("iso_3166_1") == "US"), None)
    if not us:
        return None
    for release_type in (3, 2, 1, 4):
        for rd in us.get("release_dates", []):
            if rd.get("type") == release_type and rd.get("certification"):
                return rd["certification"]
    return None


def get_us_show_certification(show_data: dict) -> str | None:
    results = show_data.get("content_ratings", {}).get("results", [])
    us = next((r for r in results if r.get("iso_3166_1") == "US"), None)
    return us.get("rating") or None if us else None


def get_theatrical_release_date(movie_data: dict) -> str | None:
    results = movie_data.get("release_dates", {}).get("results", [])

    us_entry = next(
        (r for r in results if r.get("iso_3166_1") == "US"),
        None,
    )

    if us_entry:
        for release_type in (3, 2, 1, 4):
            for rd in us_entry.get("release_dates", []):
                if rd.get("type") == release_type:
                    raw = rd.get("release_date", "")
                    return raw[:10] if raw else None

    return movie_data.get("release_date") or None


# -------------------------
# Ensure-in-DB helpers
# -------------------------


def ensure_movie_in_db(db: Session, content_id: int, already_tracked: bool) -> Movie:
    """
    Return the Movie row for content_id, creating it from TMDB if absent.
    Increments tracking_count when the row already exists and isn't tracked elsewhere.
    """
    movie = db.query(Movie).filter_by(id=content_id).first()
    if movie:
        if not already_tracked:
            movie.tracking_count += 1
            movie.updated_at = datetime.now(timezone.utc)
        return movie

    movie_data = fetch_movie_from_tmdb(
        content_id, "watch/providers,release_dates,images"
    )
    if not movie_data or not movie_data.get("title"):
        raise ValueError("Cannot add movie without a title")

    us_providers = (
        movie_data.get("watch/providers", {}).get("results", {}).get("US", {})
    )
    theatrical_release_date = get_theatrical_release_date(movie_data)
    certification = get_us_movie_certification(movie_data)
    all_logos = movie_data.get("images", {}).get("logos", [])
    english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
    logo = english_logos[0]["file_path"] if english_logos else None

    movie = Movie(
        id=movie_data["id"],
        imdb_id=movie_data.get("imdb_id"),
        backdrop_path=movie_data.get("backdrop_path"),
        logo_path=logo,
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
        tracking_count=1,
        vote_average=movie_data.get("vote_average"),
        certification=certification,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(movie)
    db.flush()
    _upsert_genres(db, movie_data.get("genres", []), MovieGenre, movie_id=movie.id)
    _upsert_providers(db, us_providers, MovieProvider, movie_id=movie.id)
    return movie


def ensure_show_in_db(db: Session, content_id: int, already_tracked: bool) -> Show:
    """
    Return the Show row for content_id, creating it from TMDB if absent.
    Increments tracking_count when the row already exists and isn't tracked elsewhere.
    """
    show = db.query(Show).filter_by(id=content_id).first()
    if show:
        if not already_tracked:
            show.tracking_count += 1
            show.updated_at = datetime.now(timezone.utc)
        return show

    show_data = fetch_show_from_tmdb(content_id, "watch/providers,images,content_ratings")
    if not show_data or not show_data.get("name"):
        raise ValueError("Cannot add show without a name")

    us_providers = show_data.get("watch/providers", {}).get("results", {}).get("US", {})
    all_logos = show_data.get("images", {}).get("logos", [])
    english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
    logo = english_logos[0]["file_path"] if english_logos else None
    air_time, air_timezone = fetch_show_air_time(show_data["name"])
    certification = get_us_show_certification(show_data)

    show = Show(
        id=show_data["id"],
        name=show_data["name"],
        backdrop_path=show_data.get("backdrop_path"),
        logo_path=logo,
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
        tracking_count=1,
        air_time=air_time,
        air_timezone=air_timezone,
        vote_average=show_data.get("vote_average"),
        certification=certification,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(show)
    db.flush()
    _upsert_genres(db, show_data.get("genres", []), ShowGenre, show_id=show.id)
    _upsert_providers(db, us_providers, ShowProvider, show_id=show.id)
    _upsert_seasons_for_show(db, show, show_data.get("seasons", []))
    return show


def decrement_tracking_count(db: Session, content_type: str, content_id: int) -> None:
    """Decrement tracking_count by one (floored at 0) for a movie or show."""
    now = datetime.now(timezone.utc)
    if content_type == "tv":
        db.query(Show).filter(Show.id == content_id, Show.tracking_count > 0).update(
            {Show.tracking_count: Show.tracking_count - 1, Show.updated_at: now},
            synchronize_session=False,
        )
    elif content_type == "movie":
        db.query(Movie).filter(Movie.id == content_id, Movie.tracking_count > 0).update(
            {Movie.tracking_count: Movie.tracking_count - 1, Movie.updated_at: now},
            synchronize_session=False,
        )


# -------------------------
# Stub + background populate helpers
# -------------------------


def ensure_show_stub_in_db(db: Session, content_id: int, already_tracked: bool) -> Show:
    """
    Fast-path: return the existing Show row or insert a minimal stub (no TMDB call).
    Call populate_show_bg as a background task after the response to fill in metadata.
    updated_at=None signals the row is a stub awaiting background population.
    """
    show = db.query(Show).filter_by(id=content_id).first()
    if show:
        if not already_tracked:
            show.tracking_count += 1
            show.updated_at = datetime.now(timezone.utc)
        return show
    show = Show(id=content_id, name="", tracking_count=1, updated_at=None)
    db.add(show)
    db.flush()
    return show


def ensure_movie_stub_in_db(db: Session, content_id: int, already_tracked: bool) -> Movie:
    """
    Fast-path: return the existing Movie row or insert a minimal stub (no TMDB call).
    Call populate_movie_bg as a background task after the response to fill in metadata.
    updated_at=None signals the row is a stub awaiting background population.
    """
    movie = db.query(Movie).filter_by(id=content_id).first()
    if movie:
        if not already_tracked:
            movie.tracking_count += 1
            movie.updated_at = datetime.now(timezone.utc)
        return movie
    movie = Movie(id=content_id, tracking_count=1, updated_at=None)
    db.add(movie)
    db.flush()
    return movie


def populate_show_bg(content_id: int) -> None:
    """
    Background task: fetch full TMDB data for a show stub and update the row.
    No-ops if the row is already fully populated (updated_at is set).
    """
    db = SessionLocal()
    try:
        show = db.query(Show).filter_by(id=content_id).first()
        if not show or show.updated_at is not None:
            return

        show_data = fetch_show_from_tmdb(content_id, "watch/providers,images,content_ratings")
        if not show_data or not show_data.get("name"):
            return

        us_providers = show_data.get("watch/providers", {}).get("results", {}).get("US", {})
        all_logos = show_data.get("images", {}).get("logos", [])
        english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
        logo = english_logos[0]["file_path"] if english_logos else None
        air_time, air_timezone = fetch_show_air_time(show_data["name"])
        certification = get_us_show_certification(show_data)

        show.name = show_data["name"]
        show.backdrop_path = show_data.get("backdrop_path")
        show.logo_path = logo
        show.last_air_date = show_data.get("last_air_date")
        show.homepage = show_data.get("homepage")
        show.in_production = show_data.get("in_production")
        show.number_of_seasons = show_data.get("number_of_seasons")
        show.number_of_episodes = show_data.get("number_of_episodes")
        show.status = show_data.get("status")
        show.tagline = show_data.get("tagline")
        show.overview = show_data.get("overview")
        show.type = show_data.get("type")
        show.first_air_date = show_data.get("first_air_date")
        show.poster_path = show_data.get("poster_path")
        show.air_time = air_time
        show.air_timezone = air_timezone
        show.vote_average = show_data.get("vote_average")
        show.certification = certification
        show.updated_at = datetime.now(timezone.utc)

        _upsert_genres(db, show_data.get("genres", []), ShowGenre, show_id=show.id)
        _upsert_providers(db, us_providers, ShowProvider, show_id=show.id)
        _upsert_seasons_for_show(db, show, show_data.get("seasons", []))

        # Backfill title on any activity rows logged with empty name
        from app.models.activity import Activity
        db.query(Activity).filter(
            Activity.content_type == "tv",
            Activity.content_id == content_id,
            Activity.content_title == "",
        ).update(
            {"content_title": show.name, "content_poster_path": show.poster_path},
            synchronize_session=False,
        )

        db.commit()

        # Sync episodes now that seasons are committed and the show row is complete.
        from app.services.episode_service import sync_show_episodes
        sync_show_episodes(db, content_id)
    except Exception as e:
        db.rollback()
        print(f"[populate_show_bg] Error for show {content_id}: {e}")
    finally:
        db.close()


def populate_movie_bg(content_id: int) -> None:
    """
    Background task: fetch full TMDB data for a movie stub and update the row.
    No-ops if the row is already fully populated (updated_at is set).
    """
    db = SessionLocal()
    try:
        movie = db.query(Movie).filter_by(id=content_id).first()
        if not movie or movie.updated_at is not None:
            return

        movie_data = fetch_movie_from_tmdb(content_id, "watch/providers,release_dates,images")
        if not movie_data or not movie_data.get("title"):
            return

        us_providers = (
            movie_data.get("watch/providers", {}).get("results", {}).get("US", {})
        )
        theatrical_release_date = get_theatrical_release_date(movie_data)
        certification = get_us_movie_certification(movie_data)
        all_logos = movie_data.get("images", {}).get("logos", [])
        english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
        logo = english_logos[0]["file_path"] if english_logos else None

        movie.imdb_id = movie_data.get("imdb_id")
        movie.backdrop_path = movie_data.get("backdrop_path")
        movie.logo_path = logo
        movie.budget = movie_data.get("budget")
        movie.homepage = movie_data.get("homepage")
        movie.tagline = movie_data.get("tagline")
        movie.poster_path = movie_data.get("poster_path")
        movie.overview = movie_data.get("overview")
        movie.release_date = theatrical_release_date
        movie.revenue = movie_data.get("revenue")
        movie.runtime = movie_data.get("runtime")
        movie.status = movie_data.get("status")
        movie.title = movie_data.get("title")
        movie.vote_average = movie_data.get("vote_average")
        movie.certification = certification
        movie.updated_at = datetime.now(timezone.utc)

        _upsert_genres(db, movie_data.get("genres", []), MovieGenre, movie_id=movie.id)
        _upsert_providers(db, us_providers, MovieProvider, movie_id=movie.id)

        # Backfill title on any activity rows logged without a title
        from app.models.activity import Activity
        db.query(Activity).filter(
            Activity.content_type == "movie",
            Activity.content_id == content_id,
            Activity.content_title == None,
        ).update(
            {"content_title": movie.title, "content_poster_path": movie.poster_path},
            synchronize_session=False,
        )

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[populate_movie_bg] Error for movie {content_id}: {e}")
    finally:
        db.close()
