from functools import lru_cache

from app.services.tmdb_client import get


# -------------------------
# Search
# -------------------------


@lru_cache(maxsize=1024)
def search_person(query: str):
    data = get(
        "/search/person",
        params={"query": query},
    )
    return data.get("results", [])


# -------------------------
# Person details
# -------------------------


@lru_cache(maxsize=1024)
def get_person(person_id: int, append: str | None):
    params = {}
    if append:
        params["append_to_response"] = append

    return get(f"/person/{person_id}", params=params)


# -------------------------
# Credits
# -------------------------


@lru_cache(maxsize=1024)
def get_person_credits(person_id: int):
    """
    Returns both movie + TV credits
    """
    data = get(f"/person/{person_id}/combined_credits")
    return data


# -------------------------
# External IDs
# -------------------------


@lru_cache(maxsize=1024)
def get_external_ids(person_id: int):
    return get(f"/person/{person_id}/external_ids")
