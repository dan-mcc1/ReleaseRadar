from fastapi import APIRouter
from fastapi.concurrency import run_in_threadpool

from app.services.tmdb_people import get_person, search_person

router = APIRouter()


@router.get("/search")
async def search(query: str):
    return await run_in_threadpool(search_person, query)


@router.get("/{id}")
async def person(id: int):
    return await run_in_threadpool(get_person, id, "")


@router.get("/{id}/info")
async def full_actor_info(id: int):
    append = "external_ids,movie_credits,tv_credits"
    person_data = await run_in_threadpool(get_person, id, append)

    if "movie_credits" in person_data and "cast" in person_data["movie_credits"]:
        person_data["movie_credits"]["cast"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )
    if "movie_credits" in person_data and "crew" in person_data["movie_credits"]:
        person_data["movie_credits"]["crew"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )
    if "tv_credits" in person_data and "cast" in person_data["tv_credits"]:
        person_data["tv_credits"]["cast"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )
    if "tv_credits" in person_data and "crew" in person_data["tv_credits"]:
        person_data["tv_credits"]["crew"].sort(
            key=lambda x: x.get("popularity", 0), reverse=True
        )

    return person_data
