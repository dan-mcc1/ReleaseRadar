# app/services/watchlist_service.py
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_, select, exists, literal, union_all, func
from datetime import datetime, timezone
from fastapi import HTTPException
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
from app.models.user import User
from app.db.session import SessionLocal, _is_sqlite
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.provider_utils import canonical_provider_id, canonical_provider_name
from app.services.activity_service import log_activity
from app.services.tvmaze_service import fetch_show_air_time
from sqlalchemy import text
from collections import defaultdict


_TRACKING_LIMIT = 30


def assert_can_track(db: Session, uid: str) -> None:
    """Raise 403 if a free-tier user has hit the tracking limit."""
    user = db.query(User).filter(User.id == uid).first()
    if user and user.subscription_tier != "free":
        return
    tracked = db.execute(
        text(
            "SELECT (SELECT COUNT(*) FROM watchlist WHERE user_id = :u)"
            " + (SELECT COUNT(*) FROM currently_watching WHERE user_id = :u)"
        ),
        {"u": uid},
    ).scalar()
    if tracked >= _TRACKING_LIMIT:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "tracking_limit_reached",
                "message": f"Free accounts can track up to {_TRACKING_LIMIT} titles.",
                "limit": _TRACKING_LIMIT,
                "current": tracked,
            },
        )

# -------------------------
# Serialization helpers
# -------------------------


def serialize_providers(junction_rows):
    """
    Convert ShowProvider/MovieProvider rows into the
    {flatrate: [...], rent: [...], buy: [...]} shape the frontend expects.
    Provider variants (e.g. "Netflix basic with ads") are collapsed to their
    canonical entry so duplicates never reach the frontend.
    """
    # Use dicts keyed by canonical_id to deduplicate within each section.
    # Prefer the canonical provider's own logo over a variant's logo (e.g. don't
    # show the "AMC+ Apple TV Channel" logo when plain "AMC+" is also available).
    sections: dict[str, dict[int, dict]] = {}
    for row in junction_rows:
        p = row.provider
        cpid = canonical_provider_id(p.id)
        entry = {
            "provider_id": cpid,
            "provider_name": canonical_provider_name(p.id, p.name),
            "logo_path": p.logo_path,
        }
        for ptype in ("flatrate", "rent", "buy"):
            if getattr(row, ptype):
                section = sections.setdefault(ptype, {})
                if cpid not in section or p.id == cpid:
                    section[cpid] = entry
    result = {ptype: list(entries.values()) for ptype, entries in sections.items()}
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
        "vote_average": show.vote_average,
        "certification": show.certification,
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
        "vote_average": movie.vote_average,
        "certification": movie.certification,
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
        "providers": serialize_providers(movie.movie_providers),
    }


# -------------------------
# Shared utilities
# -------------------------


def _get_item_title_and_poster(
    db: Session, content_type: str, content_id: int
) -> tuple[str | None, str | None]:
    if content_type == "movie":
        item = db.query(Movie).filter_by(id=content_id).first()
        return (item.title if item else None), (item.poster_path if item else None)
    item = db.query(Show).filter_by(id=content_id).first()
    return (item.name if item else None), (item.poster_path if item else None)


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
            # Update mutable fields (episode count can change as show airs)
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


def _is_tracked_on_any(
    db: Session, user_id: str, content_type: str, content_id: int, *models
) -> bool:
    """Return True if the item exists on ANY of the given list models — single UNION ALL query."""
    subqs = [
        select(literal(1))
        .select_from(model)
        .where(
            model.user_id == user_id,
            model.content_type == content_type,
            model.content_id == content_id,
        )
        for model in models
    ]
    return db.execute(select(exists(union_all(*subqs).subquery()))).scalar() or False


def _is_on_other_list(
    db: Session, user_id: str, content_type: str, content_id: int
) -> bool:
    """Return True if the item exists on CurrentlyWatching or Watched."""
    return _is_tracked_on_any(
        db, user_id, content_type, content_id, CurrentlyWatching, Watched
    )


def add_to_watchlist(db: Session, user_id: str, content_type: str, content_id: int, notify: bool = True):
    """
    Add a movie or show to the user's watchlist.
    """
    # Single round-trip: existing check + other-list check + max sort_key + tier + tracked count
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watchlist
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS existing_id,
            (SELECT COALESCE(MAX(sort_key), 0) FROM watchlist WHERE user_id = :uid) AS max_sort_key,
            EXISTS(
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM watched
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS already_tracked,
            COALESCE((SELECT subscription_tier FROM "user" WHERE id = :uid), 'free') AS subscription_tier,
            (SELECT COUNT(*) FROM watchlist WHERE user_id = :uid) +
            (SELECT COUNT(*) FROM currently_watching WHERE user_id = :uid) AS tracked_count
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.existing_id is not None:
        return {"id": row.existing_id, "content_type": content_type, "content_id": content_id}

    if row.subscription_tier == "free" and row.tracked_count >= _TRACKING_LIMIT:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "tracking_limit_reached",
                "message": f"Free accounts can track up to {_TRACKING_LIMIT} titles.",
                "limit": _TRACKING_LIMIT,
                "current": row.tracked_count,
            },
        )

    already_tracked = bool(row.already_tracked)
    max_sort_key = row.max_sort_key or 0

    entry = Watchlist(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        added_at=datetime.utcnow(),
        sort_key=max_sort_key + 1000,
        notify=notify,
    )
    db.add(entry)

    if content_type == "movie":
        media = ensure_movie_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.title, media.poster_path)
    elif content_type == "tv":
        media = ensure_show_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.name, media.poster_path)

    # entry.id is populated by log_activity's db.flush() — no post-commit SELECT needed
    result = {
        "id": entry.id,
        "user_id": entry.user_id,
        "content_type": entry.content_type,
        "content_id": entry.content_id,
        "added_at": entry.added_at.isoformat() if entry.added_at else None,
        "sort_key": entry.sort_key,
        "notify": entry.notify,
    }
    db.commit()
    return result


def _renormalize_sort_keys(db: Session, user_id: str) -> None:
    """Re-space all of a user's watchlist sort_keys to multiples of 1000."""
    items = (
        db.query(Watchlist)
        .filter_by(user_id=user_id)
        .order_by(Watchlist.sort_key)
        .all()
    )
    for i, item in enumerate(items, start=1):
        item.sort_key = i * 1000


def reorder_watchlist_item(
    db: Session,
    user_id: str,
    content_type: str,
    content_id: int,
    before_id: int | None,
    after_id: int | None,
):
    """
    Move a watchlist item so it sits between the items identified by before_id and after_id.
    before_id=None means move to top. after_id=None means move to bottom.
    Renormalizes all sort_keys for the user if any gap drops to <= 10.
    Returns the updated watchlist dict.
    """
    entry = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not entry:
        raise ValueError("Item not in watchlist")

    before_key = 0
    if before_id is not None:
        bk = (
            db.query(Watchlist.sort_key)
            .filter_by(id=before_id, user_id=user_id)
            .scalar()
        )
        if bk is None:
            raise ValueError(f"before_id {before_id} not found in user's watchlist")
        before_key = bk

    if after_id is not None:
        ak = (
            db.query(Watchlist.sort_key)
            .filter_by(id=after_id, user_id=user_id)
            .scalar()
        )
        if ak is None:
            raise ValueError(f"after_id {after_id} not found in user's watchlist")
        after_key = ak
    else:
        max_key = (
            db.query(func.max(Watchlist.sort_key)).filter_by(user_id=user_id).scalar()
            or 0
        )
        after_key = max_key + 2000

    new_sort_key = (before_key + after_key) // 2
    gap_above = new_sort_key - before_key
    gap_below = after_key - new_sort_key

    entry.sort_key = new_sort_key
    db.flush()

    if min(gap_above, gap_below) <= 10:
        _renormalize_sort_keys(db, user_id)

    db.commit()
    return get_watchlist(db, user_id)


def remove_from_watchlist(
    db: Session, user_id: str, content_type: str, content_id: int
):
    """
    Remove a movie or show from the user's watchlist.
    """
    # Single round-trip: find watchlist entry + check if still tracked elsewhere
    row = db.execute(text("""
        SELECT
            (SELECT id FROM watchlist
             WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
             LIMIT 1) AS watchlist_id,
            EXISTS(
                SELECT 1 FROM currently_watching
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
                UNION ALL
                SELECT 1 FROM watched
                WHERE user_id = :uid AND content_type = :ctype AND content_id = :cid
            ) AS still_tracked
    """), {"uid": user_id, "ctype": content_type, "cid": content_id}).first()

    if row.watchlist_id is None:
        return {"message": "Item not found in watchlist"}

    db.execute(text("DELETE FROM watchlist WHERE id = :id"), {"id": row.watchlist_id})

    if not bool(row.still_tracked):
        if content_type == "tv":
            db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=content_id).delete()
            db.query(Show).filter(Show.id == content_id, Show.tracking_count > 0).update(
                {Show.tracking_count: Show.tracking_count - 1, Show.updated_at: datetime.now(timezone.utc)},
                synchronize_session=False,
            )
        elif content_type == "movie":
            db.query(Movie).filter(Movie.id == content_id, Movie.tracking_count > 0).update(
                {Movie.tracking_count: Movie.tracking_count - 1, Movie.updated_at: datetime.now(timezone.utc)},
                synchronize_session=False,
            )

    db.commit()
    return {"message": "Removed from watchlist"}


def _show_query_options():
    """Full show relationships — for detail pages."""
    return [
        selectinload(Show.seasons),
        selectinload(Show.genres),
        selectinload(Show.show_providers).selectinload(ShowProvider.provider),
    ]


def serialize_show_calendar(show):
    """Minimal show shape for calendar views — only fields rendered by calendar components."""
    return {
        "id": show.id,
        "name": show.name,
        "poster_path": show.poster_path,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "air_time": show.air_time,
        "air_timezone": show.air_timezone,
    }


def serialize_movie_calendar(movie):
    """Minimal movie shape for calendar views — scalar columns only, no JOINs needed."""
    return {
        "id": movie.id,
        "title": movie.title,
        "overview": movie.overview,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "release_date": movie.release_date,
        "runtime": movie.runtime,
        "status": movie.status,
        "vote_average": movie.vote_average,
    }


def _movie_query_options():
    """Full movie relationships — for detail pages."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers).selectinload(MovieProvider.provider),
    ]


def _show_query_options_list():
    """Lightweight show options for list views — genres and flatrate provider IDs only."""
    return [
        selectinload(Show.genres),
        selectinload(Show.show_providers),
    ]


def _movie_query_options_list():
    """Lightweight movie options for list views — genres and flatrate provider IDs only."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers),
    ]


def serialize_show_list(show):
    """Serialize a show for list views — omits full season/provider detail."""
    return {
        "id": show.id,
        "name": show.name,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "first_air_date": show.first_air_date,
        "last_air_date": show.last_air_date,
        "in_production": show.in_production,
        "number_of_seasons": show.number_of_seasons,
        "number_of_episodes": show.number_of_episodes,
        "overview": show.overview,
        "poster_path": show.poster_path,
        "status": show.status,
        "tracking_count": show.tracking_count,
        "vote_average": show.vote_average,
        "certification": show.certification,
        "genres": [{"id": g.id, "name": g.name} for g in show.genres],
        "flatrate_provider_ids": [sp.provider_id for sp in show.show_providers if sp.flatrate],
    }


def serialize_movie_list(movie):
    """Serialize a movie for list views — omits full provider detail."""
    return {
        "id": movie.id,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "overview": movie.overview,
        "poster_path": movie.poster_path,
        "release_date": movie.release_date,
        "runtime": movie.runtime,
        "status": movie.status,
        "title": movie.title,
        "tracking_count": movie.tracking_count,
        "vote_average": movie.vote_average,
        "certification": movie.certification,
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
        "flatrate_provider_ids": [mp.provider_id for mp in movie.movie_providers if mp.flatrate],
    }


def _get_watchlist_items(db: Session, user_id: str, content_type: str):
    if content_type == "tv":
        model, options, content_id_col, serialize = (
            Show,
            _show_query_options_list(),
            Show.id,
            serialize_show_list,
        )
    else:
        model, options, content_id_col, serialize = (
            Movie,
            _movie_query_options_list(),
            Movie.id,
            serialize_movie_list,
        )

    rows = (
        db.query(model, Watchlist.added_at, Watchlist.sort_key, Watchlist.id)
        .options(*options)
        .select_from(Watchlist)
        .join(
            model,
            and_(
                Watchlist.content_id == content_id_col,
                Watchlist.content_type == content_type,
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.sort_key)
        .all()
    )
    return [
        {
            **serialize(item),
            "added_at": added_at.isoformat() if added_at else None,
            "sort_key": sort_key,
            "watchlist_id": watchlist_id,
        }
        for item, added_at, sort_key, watchlist_id in rows
    ]


def _fetch_watchlist_movies_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            m.id, m.backdrop_path, m.logo_path, m.overview, m.poster_path,
            m.release_date, m.runtime, m.status, m.title,
            m.tracking_count, m.vote_average, m.certification,
            w.added_at, w.sort_key, w.id AS watchlist_id,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name))
                    FILTER (WHERE g.id IS NOT NULL),
                '[]'::json
            ) AS genres,
            COALESCE(
                array_agg(DISTINCT mp.provider_id)
                    FILTER (WHERE mp.flatrate = true AND mp.provider_id IS NOT NULL),
                ARRAY[]::integer[]
            ) AS flatrate_provider_ids
        FROM watchlist w
        JOIN movie m ON m.id = w.content_id AND w.content_type = 'movie'
        LEFT JOIN movie_genre mg ON mg.movie_id = m.id
        LEFT JOIN genre g ON g.id = mg.genre_id
        LEFT JOIN movie_provider mp ON mp.movie_id = m.id
        WHERE w.user_id = :uid
        GROUP BY m.id, w.added_at, w.sort_key, w.id
        ORDER BY w.sort_key
    """), {"uid": user_id}).mappings().all()
    return [
        {
            "id": r["id"],
            "backdrop_path": r["backdrop_path"],
            "logo_path": r["logo_path"],
            "overview": r["overview"],
            "poster_path": r["poster_path"],
            "release_date": r["release_date"],
            "runtime": r["runtime"],
            "status": r["status"],
            "title": r["title"],
            "tracking_count": r["tracking_count"],
            "vote_average": r["vote_average"],
            "certification": r["certification"],
            "genres": r["genres"],
            "flatrate_provider_ids": r["flatrate_provider_ids"],
            "added_at": r["added_at"].isoformat() if r["added_at"] else None,
            "sort_key": r["sort_key"],
            "watchlist_id": r["watchlist_id"],
        }
        for r in rows
    ]


def _fetch_watchlist_shows_pg(s: Session, user_id: str) -> list[dict]:
    rows = s.execute(text("""
        SELECT
            sh.id, sh.name, sh.backdrop_path, sh.logo_path, sh.first_air_date,
            sh.last_air_date, sh.in_production, sh.number_of_seasons,
            sh.number_of_episodes, sh.overview, sh.poster_path, sh.status,
            sh.tracking_count, sh.vote_average, sh.certification,
            w.added_at, w.sort_key, w.id AS watchlist_id,
            COALESCE(
                json_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name))
                    FILTER (WHERE g.id IS NOT NULL),
                '[]'::json
            ) AS genres,
            COALESCE(
                array_agg(DISTINCT sp.provider_id)
                    FILTER (WHERE sp.flatrate = true AND sp.provider_id IS NOT NULL),
                ARRAY[]::integer[]
            ) AS flatrate_provider_ids
        FROM watchlist w
        JOIN show sh ON sh.id = w.content_id AND w.content_type = 'tv'
        LEFT JOIN show_genre sg ON sg.show_id = sh.id
        LEFT JOIN genre g ON g.id = sg.genre_id
        LEFT JOIN show_provider sp ON sp.show_id = sh.id
        WHERE w.user_id = :uid
        GROUP BY sh.id, w.added_at, w.sort_key, w.id
        ORDER BY w.sort_key
    """), {"uid": user_id}).mappings().all()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "backdrop_path": r["backdrop_path"],
            "logo_path": r["logo_path"],
            "first_air_date": r["first_air_date"],
            "last_air_date": r["last_air_date"],
            "in_production": r["in_production"],
            "number_of_seasons": r["number_of_seasons"],
            "number_of_episodes": r["number_of_episodes"],
            "overview": r["overview"],
            "poster_path": r["poster_path"],
            "status": r["status"],
            "tracking_count": r["tracking_count"],
            "vote_average": r["vote_average"],
            "certification": r["certification"],
            "genres": r["genres"],
            "flatrate_provider_ids": r["flatrate_provider_ids"],
            "added_at": r["added_at"].isoformat() if r["added_at"] else None,
            "sort_key": r["sort_key"],
            "watchlist_id": r["watchlist_id"],
        }
        for r in rows
    ]


def get_watchlist(db: Session, user_id: str):
    # SQLite (tests) doesn't support json_agg — fall back to ORM path.
    if _is_sqlite:
        return {
            "movies": _get_watchlist_items(db, user_id, "movie"),
            "shows": _get_watchlist_items(db, user_id, "tv"),
        }

    def _with_session(fn):
        s = SessionLocal()
        try:
            return fn(s)
        finally:
            s.close()

    with ThreadPoolExecutor(max_workers=2) as ex:
        f_movies = ex.submit(_with_session, lambda s: _fetch_watchlist_movies_pg(s, user_id))
        f_shows = ex.submit(_with_session, lambda s: _fetch_watchlist_shows_pg(s, user_id))

    return {"movies": f_movies.result(), "shows": f_shows.result()}


def get_watchlist_status(id: int, db: Session, user_id: str, content_type: str):
    row = db.execute(
        text("""
        SELECT 'Currently Watching' AS status, NULL::float AS rating
        FROM currently_watching
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        UNION ALL
        SELECT 'Want To Watch', NULL
        FROM watchlist
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        UNION ALL
        SELECT 'Watched', rating
        FROM watched
        WHERE user_id = :uid AND content_id = :cid AND content_type = :ctype
        LIMIT 1
    """),
        {"uid": user_id, "cid": id, "ctype": content_type},
    ).first()

    if not row:
        return {"status": "none"}
    if row.status == "Watched":
        return {"status": "Watched", "rating": row.rating}
    return {"status": row.status}


def get_tv_calendar(
    db: Session,
    user_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
):
    """
    Return TV shows in the user's watchlist + currently-watching list with their
    episodes. When from_date/to_date are provided, only episodes in that range are
    returned (and shows with no episodes in the range are omitted). Without date
    params, all episodes are returned (legacy behaviour).
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
        .filter(
            CurrentlyWatching.user_id == user_id, CurrentlyWatching.content_type == "tv"
        )
        .all()
    }
    show_ids = list(watchlist_ids | cw_ids)

    if not show_ids:
        return []

    # 2. Load show metadata — scalar columns only, no relationship joins needed
    shows = db.query(Show).filter(Show.id.in_(show_ids)).all()

    # 3. Load episodes, optionally filtered to the requested date window
    eps_query = db.query(Episode).filter(Episode.show_id.in_(show_ids))
    if from_date:
        eps_query = eps_query.filter(Episode.air_date >= from_date)
    if to_date:
        eps_query = eps_query.filter(Episode.air_date <= to_date)
    episodes = eps_query.order_by(
        Episode.show_id, Episode.season_number, Episode.episode_number
    ).all()

    eps_by_show: dict[int, list] = defaultdict(list)
    for ep in episodes:
        eps_by_show[ep.show_id].append(
            {
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
            }
        )

    # When date-filtering, omit shows that have no episodes in the window
    filtering = bool(from_date or to_date)
    return [
        {"show": serialize_show_calendar(show), "episodes": eps_by_show[show.id]}
        for show in shows
        if not filtering or eps_by_show[show.id]
    ]
