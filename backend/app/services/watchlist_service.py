# app/services/watchlist_service.py
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_, select, exists, literal, union_all, func
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
        "vote_average": show.vote_average,
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
    Each provider appears once in the provider table; the junction row
    tracks which types (flatrate/rent/buy) it offers for this media item.
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


def ensure_movie_in_db(db: Session, content_id: int, already_tracked: bool) -> Movie:
    """
    Return the Movie row for content_id, creating it from TMDB if absent.
    Increments tracking_count when the row already exists and isn't tracked elsewhere.
    """
    movie = db.query(Movie).filter_by(id=content_id).first()
    if movie:
        if not already_tracked:
            movie.tracking_count += 1
        return movie

    movie_data = fetch_movie_from_tmdb(content_id, "watch/providers,release_dates,images")
    if not movie_data or not movie_data.get("title"):
        raise ValueError("Cannot add movie without a title")

    us_providers = movie_data.get("watch/providers", {}).get("results", {}).get("US", {})
    theatrical_release_date = get_theatrical_release_date(movie_data)
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
        return show

    show_data = fetch_show_from_tmdb(content_id, "watch/providers,images")
    if not show_data or not show_data.get("name"):
        raise ValueError("Cannot add show without a name")

    us_providers = show_data.get("watch/providers", {}).get("results", {}).get("US", {})
    all_logos = show_data.get("images", {}).get("logos", [])
    english_logos = [l for l in all_logos if l.get("iso_639_1") == "en"]
    logo = english_logos[0]["file_path"] if english_logos else None
    air_time, air_timezone = fetch_show_air_time(show_data["name"])

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
    return _is_tracked_on_any(db, user_id, content_type, content_id, CurrentlyWatching, Watched)


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

    already_tracked = _is_on_other_list(db, user_id, content_type, content_id)

    max_sort_key = (
        db.query(func.max(Watchlist.sort_key))
        .filter_by(user_id=user_id)
        .scalar()
    ) or 0

    entry = Watchlist(
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        added_at=datetime.utcnow(),
        sort_key=max_sort_key + 1000,
    )
    db.add(entry)

    if content_type == "movie":
        media = ensure_movie_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.title, media.poster_path)
    elif content_type == "tv":
        media = ensure_show_in_db(db, content_id, already_tracked)
        log_activity(db, user_id, "want_to_watch", content_type, content_id, media.name, media.poster_path)

    db.commit()
    db.refresh(entry)
    return entry


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
        bk = db.query(Watchlist.sort_key).filter_by(id=before_id, user_id=user_id).scalar()
        if bk is None:
            raise ValueError(f"before_id {before_id} not found in user's watchlist")
        before_key = bk

    if after_id is not None:
        ak = db.query(Watchlist.sort_key).filter_by(id=after_id, user_id=user_id).scalar()
        if ak is None:
            raise ValueError(f"after_id {after_id} not found in user's watchlist")
        after_key = ak
    else:
        max_key = db.query(func.max(Watchlist.sort_key)).filter_by(user_id=user_id).scalar() or 0
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
    entry = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )

    if not entry:
        return {"message": "Item not found in watchlist"}

    db.delete(entry)

    # Only decrement tracking_count if not still on any other list
    still_tracked = _is_on_other_list(db, user_id, content_type, content_id)

    # If the user is no longer on any list for this TV show, clear their episode progress
    if not still_tracked and content_type == "tv":
        db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=content_id).delete()

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
    """Full show relationships — for detail pages."""
    return [
        selectinload(Show.seasons),
        selectinload(Show.genres),
        selectinload(Show.show_providers).selectinload(ShowProvider.provider),
    ]


def _movie_query_options():
    """Full movie relationships — for detail pages."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers).selectinload(MovieProvider.provider),
    ]


def _show_query_options_list():
    """Lightweight show options for list views — genres only, no seasons or providers."""
    return [selectinload(Show.genres)]


def _movie_query_options_list():
    """Lightweight movie options for list views — genres only, no providers."""
    return [selectinload(Movie.genres)]


def serialize_show_list(show):
    """Serialize a show for list views — omits seasons and providers."""
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
        "genres": [{"id": g.id, "name": g.name} for g in show.genres],
    }


def serialize_movie_list(movie):
    """Serialize a movie for list views — omits providers."""
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
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
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


def get_watchlist(db: Session, user_id: str):
    movies = _get_watchlist_items(db, user_id, "movie")
    shows = _get_watchlist_items(db, user_id, "tv")
    return {"movies": movies, "shows": shows}


def get_watchlist_status(id: int, db: Session, user_id: str, content_type: str):
    row = db.execute(
        text(
            """
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
    """
        ),
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

    # 2. Load show metadata + relationships
    shows = (
        db.query(Show)
        .options(*_show_query_options())
        .filter(Show.id.in_(show_ids))
        .all()
    )

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
        {"show": serialize_show(show), "episodes": eps_by_show[show.id]}
        for show in shows
        if not filtering or eps_by_show[show.id]
    ]
