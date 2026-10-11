import asyncio
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.concurrency import run_in_threadpool

from app.services.tmdb_search import (
    get_collection_search_results,
    get_genre_list,
    get_movie_by_genre,
    get_movie_now_playing,
    get_movie_search_results,
    get_movie_trending_results,
    get_movie_upcoming,
    get_multi_popular_results,
    get_multi_top_rated_results,
    get_multi_trending_results,
    get_person_search_results,
    get_tv_airing_today,
    get_tv_by_genre,
    get_tv_search_results,
    get_tv_trending_results,
    get_tv_upcoming,
)
from app.core.http_cache import LIST_CACHE, STATIC_CACHE
from app.core.limiter import rate_limit

router = APIRouter()


# Each query fans out to four TMDb searches; it gets a tighter budget on top
# of the router-wide public one.
@router.get(
    "",
    dependencies=[LIST_CACHE, Depends(rate_limit("search", "SEARCH_RATE_LIMIT"))],
)
async def search(
    query: str = "",
    genre_id: int = None,
    type: str = Query(None),
    page: int = Query(1, ge=1),
):
    if genre_id:
        if type == "tv":
            data = await run_in_threadpool(get_tv_by_genre, genre_id, page)
            return {
                "movies": [],
                "shows": data["results"],
                "total_pages": data["total_pages"],
                "people": [],
            }
        else:
            data = await run_in_threadpool(get_movie_by_genre, genre_id, page)
            return {
                "movies": data["results"],
                "shows": [],
                "total_pages": data["total_pages"],
                "people": [],
            }

    if not query:
        return {"movies": [], "shows": [], "people": [], "collections": []}

    movies, shows, people, collections = await asyncio.gather(
        run_in_threadpool(get_movie_search_results, query),
        run_in_threadpool(get_tv_search_results, query),
        run_in_threadpool(get_person_search_results, query),
        run_in_threadpool(get_collection_search_results, query),
    )
    return {"movies": movies, "shows": shows, "people": people, "collections": collections}


@router.get("/genres", dependencies=[STATIC_CACHE])
async def genres():
    return await run_in_threadpool(get_genre_list)


@router.get("/multi/trending", dependencies=[LIST_CACHE])
async def multi_trending():
    return await run_in_threadpool(get_multi_trending_results)


@router.get("/tv/trending", dependencies=[LIST_CACHE])
async def tv_trending(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_tv_trending_results, page)


@router.get("/movie/trending", dependencies=[LIST_CACHE])
async def movie_trending(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_movie_trending_results, page)


@router.get("/tv/upcoming", dependencies=[LIST_CACHE])
async def tv_upcoming(min_date: date, max_date: date, page: int = Query(1, ge=1)):
    return await run_in_threadpool(
        get_tv_upcoming, min_date.isoformat(), max_date.isoformat(), page
    )


@router.get("/movie/upcoming", dependencies=[LIST_CACHE])
async def movie_upcoming(min_date: date, max_date: date, page: int = Query(1, ge=1)):
    return await run_in_threadpool(
        get_movie_upcoming, min_date.isoformat(), max_date.isoformat(), page
    )


@router.get("/tv/airing-today", dependencies=[LIST_CACHE])
async def tv_airing_today(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_tv_airing_today, page)


@router.get("/movie/now-playing", dependencies=[LIST_CACHE])
async def movie_now_playing(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_movie_now_playing, page)


@router.get("/multi/popular", dependencies=[LIST_CACHE])
async def multi_popular():
    return await run_in_threadpool(get_multi_popular_results)


@router.get("/multi/top-rated", dependencies=[LIST_CACHE])
async def multi_top_rated():
    return await run_in_threadpool(get_multi_top_rated_results)
