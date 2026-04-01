from fastapi import APIRouter, HTTPException, Query
from app.services.tmdb_collections import get_collection, search_collections_paginated

router = APIRouter()


@router.get("/search")
def search_collections(query: str, page: int = Query(1, ge=1)):
    return search_collections_paginated(query, page)


@router.get("/{collection_id}")
def collection_detail(collection_id: int):
    data = get_collection(collection_id)
    if not data:
        raise HTTPException(status_code=404, detail="Collection not found")
    return data
