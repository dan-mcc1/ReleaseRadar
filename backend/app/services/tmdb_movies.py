from functools import lru_cache
from datetime import date, timedelta
from typing import Tuple, Optional

from app.services.tmdb_client import get


# -------------------------
# Core movie info
# -------------------------


@lru_cache(maxsize=1024)
def get_movie_info(movie_id: int, append: Optional[Tuple[str, ...]] = None):
    params = {}
    if append:
        params["append_to_response"] = ",".join(append)

    return get(f"/movie/{movie_id}", params=params)


# -------------------------
# Popular / Trending
# -------------------------


@lru_cache(maxsize=1024)
def get_popular_movies(region: str = "US", limit: int = 10):
    data = get(
        "/movie/popular",
        params={"region": region},
    )
    return data.get("results", [])[:limit]


@lru_cache(maxsize=1024)
def get_trending_movies(time_window: str = "week"):
    data = get(f"/trending/movie/{time_window}")
    return data.get("results", [])


# -------------------------
# Playing / Upcoming
# -------------------------


@lru_cache(maxsize=1024)
def get_now_playing_movies(region: str = "US"):
    data = get(
        "/movie/now_playing",
        params={"region": region},
    )
    return data.get("results", [])


@lru_cache(maxsize=1024)
def get_upcoming_movies(region: str = "US", days: int = 30):
    today = date.today()
    end_date = today + timedelta(days=days)

    data = get(
        "/discover/movie",
        params={
            "primary_release_date.gte": today.isoformat(),
            "primary_release_date.lte": end_date.isoformat(),
            "sort_by": "popularity.desc",
            "region": region,
        },
    )
    return data.get("results", [])


# -------------------------
# Search
# -------------------------


@lru_cache(maxsize=1024)
def search_movies(query: Optional[str] = None, genre: Optional[str] = None):
    """
    - query → /search/movie
    - genre-only → /discover/movie
    """
    if query:
        return get(
            "/search/movie",
            params={"query": query},
        ).get("results", [])

    params = {}
    if genre:
        params["with_genres"] = genre

    return get(
        "/discover/movie",
        params=params,
    ).get("results", [])


# -------------------------
# Actor search
# -------------------------


@lru_cache(maxsize=1024)
def get_movies_by_actor(actor: str):
    """
    1. Search person
    2. Fetch movie credits
    """
    person_search = get("/search/person", params={"query": actor})
    results = person_search.get("results", [])

    if not results:
        return []

    person_id = results[0]["id"]

    credits = get(f"/person/{person_id}/movie_credits")
    return credits.get("cast", [])


def fetch_movie_from_tmdb(movie_id: int, append: str = None):
    params = {}
    if append:
        # params["append_to_response"] = ",".join(append)
        params["append_to_response"] = append
    return get(f"/movie/{movie_id}", params=params)
