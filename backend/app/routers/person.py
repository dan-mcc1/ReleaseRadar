from fastapi import APIRouter
from app.config import settings
from app.services.tmdb_people import (
    search_person,
    get_person,
)

router = APIRouter()


@router.get("/search")
def search(query: str):
    return search_person(query)


@router.get("/{id}")
def person(id: int):
    return get_person(id, "")


@router.get("/{id}/info")
def full_actor_info(id: int):
    append = "external_ids,movie_credits,tv_credits"
    person = get_person(id, append)

    if "movie_credits" in person and "cast" in person["movie_credits"]:
        person["movie_credits"]["cast"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )
    if "movie_credits" in person and "crew" in person["movie_credits"]:
        person["movie_credits"]["crew"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )

    # Sort tv credits by popularity descending
    if "tv_credits" in person and "cast" in person["tv_credits"]:
        person["tv_credits"]["cast"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )
    if "tv_credits" in person and "crew" in person["tv_credits"]:
        person["tv_credits"]["crew"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )

    return person
