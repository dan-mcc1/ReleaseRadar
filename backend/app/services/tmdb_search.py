from functools import lru_cache

from app.services.tmdb_client import get


@lru_cache(maxsize=1024)
def get_collection_search_results(query: str):
    data = get("/search/collection", params={"query": query})
    return sorted(
        data.get("results", []),
        key=lambda x: x.get("popularity", 0),
        reverse=True,
    )


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
    data = get(
        "/discover/tv",
        params={
            "with_genres": genre_id,
            "sort_by": "popularity.desc",
            "page": page,
        },
    )
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=1024)
def get_movie_by_genre(genre_id: int, page: int = 1):
    data = get(
        "/discover/movie",
        params={
            "with_genres": genre_id,
            "sort_by": "popularity.desc",
            "page": page,
        },
    )
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


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
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=1024)
def get_movie_trending_results(page: int = 1):
    data = get("/trending/movie/week", params={"page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=1024)
def get_movie_upcoming(min_date: str, max_date: str, page: int = 1):
    data = get(
        "/discover/movie",
        params={
            "include_adult": "false",
            "include_video": "false",
            "language": "en-US",
            "sort_by": "popularity.desc",
            "with_release_type": "3|2",
            "primary_release_date.gte": min_date,
            "primary_release_date.lte": max_date,
            "page": page,
        },
    )
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_tv_airing_today(page: int = 1):
    data = get("/tv/airing_today", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_movie_now_playing(page: int = 1):
    data = get("/movie/now_playing", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_tv_popular(page: int = 1):
    data = get("/tv/popular", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_movie_popular(page: int = 1):
    data = get("/movie/popular", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_multi_popular_results():
    tv = get_tv_popular()
    movies = get_movie_popular()
    return {"movies": movies["results"], "shows": tv["results"]}


@lru_cache(maxsize=4)
def get_tv_top_rated(page: int = 1):
    data = get("/tv/top_rated", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_movie_top_rated(page: int = 1):
    data = get("/movie/top_rated", params={"language": "en-US", "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }


@lru_cache(maxsize=4)
def get_multi_top_rated_results():
    tv = get_tv_top_rated()
    movies = get_movie_top_rated()
    return {"movies": movies["results"], "shows": tv["results"]}


@lru_cache(maxsize=1024)
def get_tv_upcoming(min_date: str, max_date: str, page: int = 1):
    data = get(
        "/discover/tv",
        params={
            "include_adult": "false",
            "language": "en-US",
            "sort_by": "popularity.desc",
            "first_air_date.gte": min_date,
            "first_air_date.lte": max_date,
            "page": page,
        },
    )
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
    }
