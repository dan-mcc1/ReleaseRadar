from app.services.tmdb_client import get
from app.services.ttl_cache import (
    DETAIL_MAXSIZE,
    LIST_MAXSIZE,
    TTL_LONG,
    TTL_STD,
    ttl_cached,
)

# -------------------------
# Search
# -------------------------


@ttl_cached(LIST_MAXSIZE, TTL_STD)
def search_person(query: str):
    data = get(
        "/search/person",
        params={"query": query},
    )
    return data.get("results", [])


# -------------------------
# Person details
# -------------------------


@ttl_cached(DETAIL_MAXSIZE, TTL_STD)
def get_person(person_id: int, append: str | None):
    params = {}
    if append:
        params["append_to_response"] = append

    return get(f"/person/{person_id}", params=params)


# -------------------------
# Credits
# -------------------------


@ttl_cached(DETAIL_MAXSIZE, TTL_STD)
def get_person_credits(person_id: int):
    """
    Returns both movie + TV credits
    """
    data = get(f"/person/{person_id}/combined_credits")
    return data


# -------------------------
# External IDs
# -------------------------


@ttl_cached(1024, TTL_LONG)
def get_external_ids(person_id: int):
    return get(f"/person/{person_id}/external_ids")
