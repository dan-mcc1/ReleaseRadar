from fastapi import APIRouter, Query, HTTPException, Depends
from app.services.tmdb_movies import (
    fetch_movie_from_tmdb,
)
from app.models.movie import Movie
from sqlalchemy.orm import Session
from app.db.session import get_db

router = APIRouter()


@router.get("/{id}")
def get_movie_info(
    id: int,
    append: str | None = Query(None, description="Comma-separated TMDB append fields"),
    db: Session = Depends(get_db),
):
    # 1. Check DB first
    movie = db.query(Movie).filter(Movie.id == id).first()
    if movie:
        return movie

    # 2. Fetch from TMDb if not in DB
    movie_data = fetch_movie_from_tmdb(id, append)
    if not movie_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return movie_data


@router.get("/{id}/info")
def full_movie_info(id: int):
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
    movie_data = fetch_movie_from_tmdb(id, append)
    if not movie_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return movie_data

