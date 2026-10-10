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
    cached = await run_in_threadpool(get_person, id, append)

    # get_person's result is shared through its cache: build sorted copies
    # rather than sorting its lists in place.
    person_data = dict(cached)
    for credits_key in ("movie_credits", "tv_credits"):
        credits = cached.get(credits_key)
        if not isinstance(credits, dict):
            continue
        person_data[credits_key] = {
            **credits,
            **{
                part: sorted(credits[part], key=lambda x: x.get("popularity", 0), reverse=True)
                for part in ("cast", "crew")
                if part in credits
            },
        }

    return person_data
