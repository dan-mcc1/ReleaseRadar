from fastapi import APIRouter, Query, HTTPException, Depends
from sqlalchemy.orm import Session, selectinload
from app.services.tmdb_tv import (
    fetch_show_from_tmdb,
    fetch_season_data_from_tmdb,
    get_full_season_info,
)
from app.models.show import Show
from app.models.episode import Episode
from app.db.session import get_db
from app.services.watchlist_service import serialize_show, _show_query_options

router = APIRouter()


# --- DB-first single show endpoint ---
@router.get("/{id}")
def get_show_info(
    id: int,
    append: str | None = Query(None, description="Comma-separated TMDB append fields"),
    db: Session = Depends(get_db),
):
    # 1. Check DB first — load all relationships so serialize_show works
    show = db.query(Show).options(*_show_query_options()).filter(Show.id == id).first()
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
        [
            "watch/providers",
            "credits",
            "external_ids",
            "recommendations",
            "images",
            "videos",
        ]
    )
    show_data = fetch_show_from_tmdb(id, append)
    if not show_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return show_data


@router.get("/{id}/season_calendar")
def season_calendar(
    id: int,
    min_date: str | None = Query(
        None, description="ISO date YYYY-MM-DD — start of window"
    ),
    max_date: str | None = Query(
        None, description="ISO date YYYY-MM-DD — end of window"
    ),
    db: Session = Depends(get_db),
):
    """
    Return episodes for a show.
    When min_date/max_date are supplied, returns only episodes within that date
    window (used by the windowed calendar on the frontend).
    Without date params, falls back to the original 'last 2 seasons' behaviour.
    """

    def _serialize(ep: Episode) -> dict:
        return {
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

    # ── Windowed mode ────────────────────────────────────────────────────
    if min_date and max_date:
        show = db.query(Show).filter(Show.id == id).first()
        if show:
            db_episodes = (
                db.query(Episode)
                .filter(
                    Episode.show_id == id,
                    Episode.air_date >= min_date,
                    Episode.air_date <= max_date,
                )
                .order_by(Episode.season_number, Episode.episode_number)
                .all()
            )
            return [_serialize(ep) for ep in db_episodes]

        # Show not in DB — fetch recent seasons from TMDB and filter by date
        show_data = fetch_show_from_tmdb(id, append="seasons")
        if not show_data:
            raise HTTPException(status_code=404, detail="Show not found")
        recent = sorted(
            [s for s in show_data.get("seasons", []) if s.get("season_number", 0) > 0],
            key=lambda s: s["season_number"],
            reverse=True,
        )[:2]
        all_episodes = []
        for season in recent:
            for ep in fetch_season_data_from_tmdb(
                show_data["id"], season["season_number"]
            ):
                if ep.get("air_date") and min_date <= ep["air_date"] <= max_date:
                    all_episodes.append(ep)
        return all_episodes

    # ── Original mode: last 2 seasons ────────────────────────────────────
    show = (
        db.query(Show).options(selectinload(Show.seasons)).filter(Show.id == id).first()
    )

    if show:
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
            all_episodes.extend(_serialize(ep) for ep in db_episodes)
        else:
            all_episodes.extend(fetch_season_data_from_tmdb(show_id, sn))

    return all_episodes


@router.get("/{id}/full_calendar")
def full_calendar(id: int, db: Session = Depends(get_db)):
    """
    Return seasons and episodes for a show.
    If the show is not in the DB, fetch from TMDb and store it.
    """
    show = (
        db.query(Show).options(selectinload(Show.seasons)).filter(Show.id == id).first()
    )

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
    Return season metadata + full episode list from TMDB.
    """
    return get_full_season_info(id, season_number)


@router.get("/{id}/season/{season_number}/episode/{episode_number}")
def get_episode_info(id: int, season_number: int, episode_number: int):
    """
    Return full episode details from TMDb, including credits (guest stars, crew)
    and images.
    """
    from app.services.tmdb_client import get as tmdb_get

    try:
        data = tmdb_get(
            f"/tv/{id}/season/{season_number}/episode/{episode_number}",
            params={"append_to_response": "credits,images,videos,external_ids"},
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Episode not found")
    if not data:
        raise HTTPException(status_code=404, detail="Episode not found")
    # Attach show_id so the frontend can link back
    data["show_id"] = id
    return data
