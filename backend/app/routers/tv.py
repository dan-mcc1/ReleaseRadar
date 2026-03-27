from fastapi import APIRouter, Query, HTTPException, Depends
from sqlalchemy.orm import Session, selectinload
from app.services.tmdb_tv import (
    fetch_show_from_tmdb,
    get_popular_shows,
    search_tv,
    get_active_popular_shows,
    get_trending_shows,
    get_shows_airing_today,
    get_upcoming_shows,
    get_shows_by_actor,
    fetch_season_data_from_tmdb,
    get_full_season_info,
)
from app.models.show import Show
from app.models.episode import Episode
from app.models.provider import ShowProvider
from app.db.session import get_db
from app.services.watchlist_service import serialize_show, _show_query_options

router = APIRouter()


@router.get("/popular")
def popular_shows():
    return get_popular_shows()


@router.get("/popular_this_month")
def active_popular_shows(curr_month: int = Query(...), curr_year: int = Query(...)):
    return get_active_popular_shows(curr_month, curr_year)


@router.get("/by_actor")
def by_actor(query: str):
    return get_shows_by_actor(query)


# --- DB-first single show endpoint ---
@router.get("/{id}")
def get_show_info(
    id: int,
    append: str | None = Query(None, description="Comma-separated TMDB append fields"),
    db: Session = Depends(get_db),
):
    # 1. Check DB first — load all relationships so serialize_show works
    show = (
        db.query(Show)
        .options(*_show_query_options())
        .filter(Show.id == id)
        .first()
    )
    if show:
        return serialize_show(show)

    # 2. Fetch from TMDb if not in DB
    show_data = fetch_show_from_tmdb(id, append)
    if not show_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return show_data


@router.get("/{id}/full")
def get_full_show_info(id: int):
    append = ",".join(
        ["watch/providers", "credits", "external_ids", "recommendations", "images", "videos"]
    )
    show_data = fetch_show_from_tmdb(id, append)
    if not show_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return show_data


@router.get("/{id}/season_calendar")
def season_calendar(id: int, db: Session = Depends(get_db)):
    """
    Return recent episodes for a show (last 2 seasons).
    Loads from the episode table when available, falls back to TMDB.
    """
    show = db.query(Show).options(selectinload(Show.seasons)).filter(Show.id == id).first()

    if show:
        # Convert Season ORM objects to dicts for consistent access below
        seasons = [{"season_number": s.season_number} for s in show.seasons]
        show_id = show.id
    else:
        show_data = fetch_show_from_tmdb(id, append="seasons")
        if not show_data:
            raise HTTPException(status_code=404, detail="Show not found")
        seasons = show_data["seasons"]
        show_id = show_data["id"]

    current_seasons = sorted(
        [s for s in seasons if s.get("season_number", 0) > 0],
        key=lambda s: s["season_number"],
        reverse=True,
    )[:2]

    all_episodes = []
    for season in current_seasons:
        sn = season["season_number"]
        db_episodes = (
            db.query(Episode)
            .filter_by(show_id=show_id, season_number=sn)
            .order_by(Episode.episode_number)
            .all()
        )
        if db_episodes:
            all_episodes.extend(
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
                }
                for ep in db_episodes
            )
        else:
            all_episodes.extend(fetch_season_data_from_tmdb(show_id, sn))

    return all_episodes


@router.get("/{id}/full_calendar")
def full_calendar(id: int, db: Session = Depends(get_db)):
    """
    Return seasons and episodes for a show.
    If the show is not in the DB, fetch from TMDb and store it.
    """
    show = db.query(Show).options(selectinload(Show.seasons)).filter(Show.id == id).first()

    if show:
        # Convert Season ORM objects to dicts for consistent access below
        seasons = [{"season_number": s.season_number} for s in show.seasons]
        show_id = show.id
    else:
        show_data = fetch_show_from_tmdb(id, append="seasons")
        if not show_data:
            raise HTTPException(status_code=404, detail="Show not found")
        seasons = show_data["seasons"]
        show_id = show_data["id"]

    calendar = []
    for season in seasons:
        calendar.append(fetch_season_data_from_tmdb(show_id, season["season_number"]))

    return calendar


@router.get("/{id}/season/{season_number}/info")
def full_season_info(id: int, season_number: int, db: Session = Depends(get_db)):
    """
    Return season metadata + episode list.
    Loads episodes from the episode table when available, falls back to TMDB.
    """
    db_episodes = (
        db.query(Episode)
        .filter_by(show_id=id, season_number=season_number)
        .order_by(Episode.episode_number)
        .all()
    )

    if db_episodes:
        # Pull season-level metadata from the season table
        show = db.query(Show).options(selectinload(Show.seasons)).filter_by(id=id).first()
        season_meta = None
        if show:
            season_meta = next(
                (s for s in show.seasons if s.season_number == season_number),
                None,
            )

        return {
            "season_number": season_number,
            "name": season_meta.name if season_meta else f"Season {season_number}",
            "overview": season_meta.overview if season_meta else "",
            "air_date": str(season_meta.air_date) if season_meta and season_meta.air_date else None,
            "poster_path": season_meta.poster_path if season_meta else None,
            "episodes": [
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
                }
                for ep in db_episodes
            ],
        }

    # Fall back to TMDB if episodes not yet synced
    return get_full_season_info(id, season_number)
