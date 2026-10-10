from functools import lru_cache

import httpx

from app.services.tmdb_client import get


def fetch_collection(collection_id: int):
    """Uncached /collection/{id}. Returns None when TMDb no longer has the
    collection (deleted, or merged into another as a duplicate) —
    tmdb_client.get raises on 404. The nightly ingest uses this directly so it
    always sees today's data."""
    try:
        return get(f"/collection/{collection_id}")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        raise


@lru_cache(maxsize=1024)
def get_collection(collection_id: int):
    """Cached fetch_collection, for request paths."""
    return fetch_collection(collection_id)


@lru_cache(maxsize=1024)
def search_collections_paginated(query: str, page: int = 1):
    data = get("/search/collection", params={"query": query, "page": page})
    return {
        "results": data.get("results", []),
        "total_pages": min(data.get("total_pages", 1), 500),
        "total_results": data.get("total_results", 0),
    }
