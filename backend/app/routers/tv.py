from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session, selectinload

from app.db.session import get_db
from app.models.episode import Episode
from app.models.show import Show
from app.services.media_serializers import _show_query_options, serialize_show
from app.services.provider_utils import normalize_tmdb_watch_providers
from app.services.tmdb_client import async_get
from app.services.tmdb_tv import (
    fetch_season_data_from_tmdb,
    fetch_show_from_tmdb,
    get_full_season_info,
)

router = APIRouter()


@router.get("/{id}")
async def get_show_info(
    id: int,
    append: str | None = Query(None, description="Comma-separated TMDB append fields"),
    db: Session = Depends(get_db),
):
    show = await run_in_threadpool(
        lambda: db.query(Show).options(*_show_query_options()).filter(Show.id == id).first()
    )
    if show:
        return serialize_show(show)
    payload = await run_in_threadpool(fetch_show_from_tmdb, id, append)
    if not payload:
        raise HTTPException(status_code=404, detail="Show not found")
    return payload


@router.get("/{id}/full")
async def get_full_show_info(
    id: int,
    db: Session = Depends(get_db),
):
    append = ",".join(
        [
            "watch/providers",
            "credits",
            "external_ids",
            "recommendations",
            "images",
            "videos",
            "content_ratings",
        ]
    )
    show_data = await run_in_threadpool(fetch_show_from_tmdb, id, append)
    if not show_data:
        raise HTTPException(status_code=404, detail="Show not found")

    db_show = await run_in_threadpool(
        lambda: db.query(Show).filter(Show.id == id).first()
    )
    if db_show:
        if db_show.backdrop_path:
            show_data["backdrop_path"] = db_show.backdrop_path
        if db_show.poster_path:
            show_data["poster_path"] = db_show.poster_path
        if db_show.logo_path:
            show_data["logo_path"] = db_show.logo_path

    if not show_data.get("logo_path"):
        logos = show_data.get("images", {}).get("logos", [])
        en_logos = [l for l in logos if l.get("iso_639_1") in ("en", None)]
        if en_logos:
            show_data["logo_path"] = en_logos[0]["file_path"]
        elif logos:
            show_data["logo_path"] = logos[0]["file_path"]

    us_providers = show_data.get("watch/providers", {}).get("results", {}).get("US")
    if us_providers:
        normalize_tmdb_watch_providers(us_providers)

    return show_data


@router.get("/{id}/season_calendar")
async def season_calendar(
    id: int,
    min_date: str | None = Query(None, description="ISO date YYYY-MM-DD — start of window"),
    max_date: str | None = Query(None, description="ISO date YYYY-MM-DD — end of window"),
    db: Session = Depends(get_db),
):
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

    if min_date and max_date:
        show = await run_in_threadpool(
            lambda: db.query(Show).filter(Show.id == id).first()
        )
        if show:
            db_episodes = await run_in_threadpool(
                lambda: db.query(Episode)
                .filter(
                    Episode.show_id == id,
                    Episode.air_date >= min_date,
                    Episode.air_date <= max_date,
                )
                .order_by(Episode.season_number, Episode.episode_number)
                .all()
            )
            return [_serialize(ep) for ep in db_episodes]

        show_data = await run_in_threadpool(fetch_show_from_tmdb, id, "seasons")
        if not show_data:
            raise HTTPException(status_code=404, detail="Show not found")
        recent = sorted(
            [s for s in show_data.get("seasons", []) if s.get("season_number", 0) > 0],
            key=lambda s: s["season_number"],
            reverse=True,
        )[:2]
        all_episodes = []
        for season in recent:
            for ep in await run_in_threadpool(
                fetch_season_data_from_tmdb, show_data["id"], season["season_number"]
            ):
                if ep.get("air_date") and min_date <= ep["air_date"] <= max_date:
                    all_episodes.append(ep)
        return all_episodes

    show = await run_in_threadpool(
        lambda: db.query(Show)
        .options(selectinload(Show.seasons))
        .filter(Show.id == id)
        .first()
    )

    if show:
        seasons = [{"season_number": s.season_number} for s in show.seasons]
        show_id = show.id
    else:
        show_data = await run_in_threadpool(fetch_show_from_tmdb, id, "seasons")
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
        db_episodes = await run_in_threadpool(
            lambda sn=sn: db.query(Episode)
            .filter_by(show_id=show_id, season_number=sn)
            .order_by(Episode.episode_number)
            .all()
        )
        if db_episodes:
            all_episodes.extend(_serialize(ep) for ep in db_episodes)
        else:
            all_episodes.extend(
                await run_in_threadpool(fetch_season_data_from_tmdb, show_id, sn)
            )

    return all_episodes


@router.get("/{id}/full_calendar")
async def full_calendar(id: int, db: Session = Depends(get_db)):
    show = await run_in_threadpool(
        lambda: db.query(Show)
        .options(selectinload(Show.seasons))
        .filter(Show.id == id)
        .first()
    )

    if show:
        seasons = [{"season_number": s.season_number} for s in show.seasons]
        show_id = show.id
    else:
        show_data = await run_in_threadpool(fetch_show_from_tmdb, id, "seasons")
        if not show_data:
            raise HTTPException(status_code=404, detail="Show not found")
        seasons = show_data["seasons"]
        show_id = show_data["id"]

    calendar = []
    for season in seasons:
        calendar.append(
            await run_in_threadpool(fetch_season_data_from_tmdb, show_id, season["season_number"])
        )

    return calendar


@router.get("/{id}/episode_ratings")
async def episode_ratings(id: int, db: Session = Depends(get_db)):
    show = await run_in_threadpool(
        lambda: db.query(Show).filter(Show.id == id).first()
    )
    if not show:
        raise HTTPException(status_code=404, detail="Show not found")

    episodes = await run_in_threadpool(
        lambda: db.query(Episode)
        .filter(Episode.show_id == id, Episode.season_number > 0)
        .order_by(Episode.season_number, Episode.episode_number)
        .all()
    )

    seasons: dict[int, list] = {}
    for ep in episodes:
        seasons.setdefault(ep.season_number, []).append(
            {
                "episode_number": ep.episode_number,
                "name": ep.name,
                "vote_average": ep.vote_average if ep.vote_average else None,
            }
        )

    return [
        {"season_number": sn, "episodes": eps}
        for sn, eps in sorted(seasons.items())
    ]


@router.get("/{id}/season/{season_number}/info")
async def full_season_info(id: int, season_number: int, db: Session = Depends(get_db)):
    return await run_in_threadpool(get_full_season_info, id, season_number)


@router.get("/{id}/season/{season_number}/episode/{episode_number}")
async def get_episode_info(id: int, season_number: int, episode_number: int):
    try:
        data = await async_get(
            f"/tv/{id}/season/{season_number}/episode/{episode_number}",
            params={"append_to_response": "credits,images,videos,external_ids"},
        )
    except Exception:
        raise HTTPException(status_code=404, detail="Episode not found")
    if not data:
        raise HTTPException(status_code=404, detail="Episode not found")
    data["show_id"] = id
    return data
