from fastapi import APIRouter, Query
from app.services.tmdb_search import (
    get_tv_search_results,
    get_movie_search_results,
    get_multi_trending_results,
    get_tv_trending_results,
    get_movie_trending_results,
    get_movie_upcoming,
    get_tv_upcoming,
    get_person_search_results,
    get_genre_list,
    get_tv_by_genre,
    get_movie_by_genre,
    get_collection_search_results,
)

router = APIRouter()


@router.get("")
def search(query: str = "", genre_id: int = None, type: str = Query(None), page: int = Query(1, ge=1)):
    # Genre mode: use TMDB /discover sorted by popularity
    if genre_id:
        if type == "tv":
            data = get_tv_by_genre(genre_id, page)
            return {"movies": [], "shows": data["results"], "total_pages": data["total_pages"], "people": []}
        else:
            data = get_movie_by_genre(genre_id, page)
            return {"movies": data["results"], "shows": [], "total_pages": data["total_pages"], "people": []}

    # Text search mode
    if not query:
        return {"movies": [], "shows": [], "people": [], "collections": []}

    return {
        "movies": get_movie_search_results(query),
        "shows": get_tv_search_results(query),
        "people": get_person_search_results(query),
        "collections": get_collection_search_results(query),
    }


@router.get("/genres")
def genres():
    return get_genre_list()


@router.get("/multi/trending")
def multi_trending():
    return get_multi_trending_results()


@router.get("/tv/trending")
def tv_trending(page: int = Query(1, ge=1)):
    return get_tv_trending_results(page)


@router.get("/movie/trending")
def movie_trending(page: int = Query(1, ge=1)):
    return get_movie_trending_results(page)


@router.get("/tv/upcoming")
def tv_upcoming(min_date: str, max_date: str, page: int = Query(1, ge=1)):
    return get_tv_upcoming(min_date, max_date, page)


@router.get("/movie/upcoming")
def movie_upcoming(min_date: str, max_date: str, page: int = Query(1, ge=1)):
    return get_movie_upcoming(min_date, max_date, page)
