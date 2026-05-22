from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.movie import Movie
from app.services.media_serializers import _movie_query_options, serialize_movie
from app.services.provider_utils import normalize_tmdb_watch_providers
from app.services.tmdb_movies import fetch_movie_from_tmdb

router = APIRouter()


@router.get("/{id}")
async def get_movie_info(
    id: int,
    append: str | None = Query(None, description="Comma-separated TMDB append fields"),
    db: Session = Depends(get_db),
):
    movie = await run_in_threadpool(
        lambda: db.query(Movie).options(*_movie_query_options()).filter(Movie.id == id).first()
    )
    if movie:
        return serialize_movie(movie)
    payload = await run_in_threadpool(fetch_movie_from_tmdb, id, append)
    if not payload:
        raise HTTPException(status_code=404, detail="Show not found")
    return payload


@router.get("/{id}/info")
async def full_movie_info(
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
            "release_dates",
        ]
    )
    movie_data = await run_in_threadpool(fetch_movie_from_tmdb, id, append)
    if not movie_data:
        raise HTTPException(status_code=404, detail="Show not found")

    db_movie = await run_in_threadpool(
        lambda: db.query(Movie).filter(Movie.id == id).first()
    )
    if db_movie:
        if db_movie.backdrop_path:
            movie_data["backdrop_path"] = db_movie.backdrop_path
        if db_movie.poster_path:
            movie_data["poster_path"] = db_movie.poster_path
        if db_movie.logo_path:
            movie_data["logo_path"] = db_movie.logo_path

    if not movie_data.get("logo_path"):
        logos = movie_data.get("images", {}).get("logos", [])
        en_logos = [l for l in logos if l.get("iso_639_1") in ("en", None)]
        if en_logos:
            movie_data["logo_path"] = en_logos[0]["file_path"]
        elif logos:
            movie_data["logo_path"] = logos[0]["file_path"]

    us_providers = movie_data.get("watch/providers", {}).get("results", {}).get("US")
    if us_providers:
        normalize_tmdb_watch_providers(us_providers)

    return movie_data
