from functools import lru_cache

from app.services.tmdb_client import get


@lru_cache(maxsize=1024)
def get_collection(collection_id: int):
    return get(f"/collection/{collection_id}")


@lru_cache(maxsize=1024)
def search_collections_paginated(query: str, page: int = 1):
    data = get("/search/collection", params={"query": query, "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
        "total_results": data.get("total_results", 0),
    }
