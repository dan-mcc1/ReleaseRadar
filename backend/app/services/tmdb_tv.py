import threading
from datetime import date, timedelta
from typing import Tuple, Optional

from cachetools import TTLCache, cached
from app.services.tmdb_client import get

# All caches are thread-safe (individual RLock per cache) because the nightly
# refresh loop calls these functions from a ThreadPoolExecutor.
_TTL_SHORT = 1_800   # 30 min — trending / popular lists
_TTL_STD   = 3_600   # 1 h  — show/season detail
_TTL_LONG  = 86_400  # 24 h — rarely-changing data (external IDs)


def _cache(maxsize: int, ttl: int):
    return {"cache": TTLCache(maxsize=maxsize, ttl=ttl), "lock": threading.RLock()}


# -------------------------
# Core show info
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_show(tv_id: int, append: Optional[Tuple[str, ...]] = None):
    params = {}
    if append:
        params["append_to_response"] = ",".join(append)

    return get(f"/tv/{tv_id}", params=params)


# -------------------------
# Popular / Trending
# -------------------------


@cached(**_cache(1024, _TTL_SHORT))
def get_popular_shows(region: str = "US", limit: int = 10):
    data = get(
        "/tv/popular",
        params={"region": region},
    )
    return data.get("results", [])[:limit]


@cached(**_cache(1024, _TTL_SHORT))
def get_trending_shows(time_window: str = "week"):
    # time_window: "day" | "week"
    data = get(f"/trending/tv/{time_window}")
    return data.get("results", [])


# -------------------------
# Airing / Upcoming
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_shows_airing_today(region: str = "US"):
    data = get(
        "/tv/airing_today",
        params={"region": region},
    )
    return data.get("results", [])


@cached(**_cache(1024, _TTL_STD))
def get_upcoming_shows(region: str = "US", days: int = 7):
    today = date.today()
    end_date = today + timedelta(days=days)

    data = get(
        "/discover/tv",
        params={
            "air_date.gte": today.isoformat(),
            "air_date.lte": end_date.isoformat(),
            "sort_by": "popularity.desc",
            "with_origin_country": region,
        },
    )
    return data.get("results", [])


# -------------------------
# Monthly popular (airing)
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_active_popular_shows(curr_month: int, curr_year: int):
    start_date = date(curr_year, curr_month, 1)

    if curr_month == 12:
        end_date = date(curr_year, 12, 31)
    else:
        end_date = date(curr_year, curr_month + 1, 1) - timedelta(days=1)

    data = get(
        "/discover/tv",
        params={
            "sort_by": "popularity.desc",
            "air_date.gte": start_date.isoformat(),
            "air_date.lte": end_date.isoformat(),
        },
    )

    return data.get("results", [])


# -------------------------
# Search
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def search_tv(query: str):
    """
    - If query exists → /search/tv
    - Else → /discover/tv
    """
    if query:
        return get(
            "/search/tv",
            params={"query": query},
        ).get("results", [])

    return get(
        "/discover/tv",
    ).get("results", [])


# -------------------------
# Actor search
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_shows_by_actor(query: str):
    """
    1. Search person
    2. Fetch TV credits
    """
    person_search = get("/search/person", params={"query": query})
    results = person_search.get("results", [])

    if not results:
        return []

    person_id = results[0]["id"]

    credits = get(f"/person/{person_id}/tv_credits")
    return credits.get("cast", [])


# -------------------------
# Recommendations
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_show_recommendations(tv_id: int):
    data = get(f"/tv/{tv_id}/recommendations")
    return data.get("results", [])


# -------------------------
# External IDs (IMDb, TVDB, etc.)
# -------------------------


@cached(**_cache(1024, _TTL_LONG))
def get_show_external_ids(tv_id: int):
    return get(f"/tv/{tv_id}/external_ids")


# -------------------------
# Networks
# -------------------------


@cached(**_cache(1024, _TTL_STD))
def get_show_networks(tv_id: int):
    show = get(f"/tv/{tv_id}")
    return show.get("networks", [])


# -------------------------
# Calendar (ALL episodes with air dates)
# -------------------------


@cached(**_cache(512, _TTL_STD))
def get_show_full_calendar(tv_id: int):
    """
    Returns ALL episodes that have an air_date
    (used for calendars)
    """
    show = get(f"/tv/{tv_id}")
    episodes = []

    for season in show.get("seasons", []):
        season_number = season["season_number"]

        # Skip specials
        if season_number == 0:
            continue

        season_data = get(f"/tv/{tv_id}/season/{season_number}")

        for ep in season_data.get("episodes", []):
            if ep.get("air_date"):
                episodes.append(ep)

    return {
        "show_details": show,
        "episodes": episodes,
    }


# -------------------------
# Calendar (Current seaon episodes)
# -------------------------


@cached(**_cache(512, _TTL_STD))
def get_show_season_calendar(tv_id: int):
    """
    Returns episodes in current season that have an air_date
    (used for calendars)
    """
    show = get(f"/tv/{tv_id}")
    episodes = []

    # Filter out specials and get the latest season
    non_special_seasons = [
        s for s in show.get("seasons", []) if s.get("season_number", 0) > 0
    ]
    if not non_special_seasons:
        return {"show_details": show, "episodes": []}

    latest_season = max(non_special_seasons, key=lambda s: s["season_number"])
    season_number = latest_season["season_number"]

    season_data = get(f"/tv/{tv_id}/season/{season_number}")

    for ep in season_data.get("episodes", []):
        if ep.get("air_date"):
            episodes.append(ep)

    return {
        "show_details": show,
        "episodes": episodes,
    }


def fetch_show_from_tmdb(show_id: int, append: str | None):
    params = {}
    if append:
        # params["append_to_response"] = ",".join(append)
        params["append_to_response"] = append

    return get(f"/tv/{show_id}", params=params)


@cached(**_cache(1024, _TTL_STD))
def fetch_season_data_from_tmdb(show_id: int, season_number: int):
    episodes = []

    season_data = get(f"/tv/{show_id}/season/{season_number}")

    for ep in season_data.get("episodes", []):
        if ep.get("air_date"):
            episodes.append(ep)

    return episodes


@cached(**_cache(1024, _TTL_STD))
def get_full_season_info(id: int, season_number: int):
    return get(f"/tv/{id}/season/{season_number}")
