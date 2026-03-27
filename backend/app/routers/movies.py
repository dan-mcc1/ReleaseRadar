from fastapi import APIRouter, Query, HTTPException, Depends
from app.services.tmdb_movies import (
    get_popular_movies,
    get_trending_movies,
    get_now_playing_movies,
    get_upcoming_movies,
    search_movies,
    get_movies_by_actor,
    get_movie_info,
    fetch_movie_from_tmdb,
)
from app.models.movie import Movie
from sqlalchemy.orm import Session
from app.db.session import get_db

router = APIRouter()


@router.get("/popular")
def popular():
    return get_popular_movies()


@router.get("/now_playing")
def now_playing():
    return get_now_playing_movies()


@router.get("/by_actor")
def by_actor(actor: str):
    return get_movies_by_actor(actor)


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
        ["watch/providers", "credits", "external_ids", "recommendations", "images", "videos"]
    )
    movie_data = fetch_movie_from_tmdb(id, append)
    if not movie_data:
        raise HTTPException(status_code=404, detail="Show not found")

    return movie_data


# @router.get("/{id}")
# def movie(id: int):
#     return get_movie(id)


# @router.get("/{id}/recommendations")
# def get_recommendations(id: int):
#     return get_movie_recommendations(id)


# @router.get("/{id}/external_ids")
# def get_external_ids(id: int):
#     return get_movie_external_ids


# @router.get("/{id}/providers")
# def get_providers(id: int):
#     return get_movie_providers(id)
