from functools import lru_cache

from app.services.tmdb_client import get


@lru_cache(maxsize=1024)
def get_multi_search_results(query: str):
    return {
        "movies": get_movie_search_results(query),
        "shows": get_tv_search_results(query),
        "people": get_person_search_results(query),
    }


@lru_cache(maxsize=1024)
def get_tv_search_results(query: str):
    data = get("/search/tv", params={"query": query})
    return sorted(
        data.get("results", []),
        key=lambda x: x.get("popularity", 0),
        reverse=True,
    )


@lru_cache(maxsize=1024)
def get_movie_search_results(query: str):
    data = get("/search/movie", params={"query": query})
    return sorted(
        data.get("results", []),
        key=lambda x: x.get("popularity", 0),
        reverse=True,
    )


@lru_cache(maxsize=1024)
def get_person_search_results(query: str):
    data = get("/search/person", params={"query": query})
    return sorted(
        data.get("results", []),
        key=lambda x: x.get("popularity", 0),
        reverse=True,
    )


@lru_cache(maxsize=4)
def get_genre_list():
    movie_genres = get("/genre/movie/list").get("genres", [])
    tv_genres = get("/genre/tv/list").get("genres", [])
    return {"movie": movie_genres, "tv": tv_genres}


@lru_cache(maxsize=1024)
def get_tv_by_genre(genre_id: int, page: int = 1):
    data = get("/discover/tv", params={
        "with_genres": genre_id,
        "sort_by": "popularity.desc",
        "page": page,
    })
    return {"results": data.get("results", []), "total_pages": min(data.get("total_pages", 1), 500)}


@lru_cache(maxsize=1024)
def get_movie_by_genre(genre_id: int, page: int = 1):
    data = get("/discover/movie", params={
        "with_genres": genre_id,
        "sort_by": "popularity.desc",
        "page": page,
    })
    return {"results": data.get("results", []), "total_pages": min(data.get("total_pages", 1), 500)}


@lru_cache(maxsize=1024)
def get_multi_trending_results():
    tv = get_tv_trending_results()
    movies = get_movie_trending_results()
    return {
        "movies": movies["results"],
        "shows": tv["results"],
    }


@lru_cache(maxsize=1024)
def get_tv_trending_results(page: int = 1):
    data = get("/trending/tv/week", params={"page": page})
    return {"results": data.get("results", []), "total_pages": min(data.get("total_pages", 1), 500)}


@lru_cache(maxsize=1024)
def get_movie_trending_results(page: int = 1):
    data = get("/trending/movie/week", params={"page": page})
    return {"results": data.get("results", []), "total_pages": min(data.get("total_pages", 1), 500)}


@lru_cache(maxsize=1024)
def get_movie_upcoming(min_date: str, max_date: str):
    return get(
        f"/discover/movie?include_adult=false&include_video=false&language=en-US&page=1&sort_by=popularity.desc&with_release_type=3|2&primary_release_date.gte={min_date}&primary_release_date.lte={max_date}"
    )


@lru_cache(maxsize=1024)
def get_tv_upcoming(min_date: str, max_date: str):
    return get(
        f"/discover/tv?include_adult=false&language=en-US&page=1&sort_by=popularity.desc&air_date.lte={max_date}&air_date.gte={min_date}"
    )
