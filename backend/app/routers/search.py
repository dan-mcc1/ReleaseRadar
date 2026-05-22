import asyncio

from fastapi import APIRouter, Query
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

router = APIRouter()


@router.get("")
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


@router.get("/genres")
async def genres():
    return await run_in_threadpool(get_genre_list)


@router.get("/multi/trending")
async def multi_trending():
    return await run_in_threadpool(get_multi_trending_results)


@router.get("/tv/trending")
async def tv_trending(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_tv_trending_results, page)


@router.get("/movie/trending")
async def movie_trending(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_movie_trending_results, page)


@router.get("/tv/upcoming")
async def tv_upcoming(min_date: str, max_date: str, page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_tv_upcoming, min_date, max_date, page)


@router.get("/movie/upcoming")
async def movie_upcoming(min_date: str, max_date: str, page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_movie_upcoming, min_date, max_date, page)


@router.get("/tv/airing-today")
async def tv_airing_today(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_tv_airing_today, page)


@router.get("/movie/now-playing")
async def movie_now_playing(page: int = Query(1, ge=1)):
    return await run_in_threadpool(get_movie_now_playing, page)


@router.get("/multi/popular")
async def multi_popular():
    return await run_in_threadpool(get_multi_popular_results)


@router.get("/multi/top-rated")
async def multi_top_rated():
    return await run_in_threadpool(get_multi_top_rated_results)
