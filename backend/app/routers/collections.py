from fastapi import APIRouter, HTTPException, Query
from fastapi.concurrency import run_in_threadpool

from app.services.tmdb_collections import get_collection, search_collections_paginated

router = APIRouter()


@router.get("/search")
async def search_collections(query: str, page: int = Query(1, ge=1)):
    return await run_in_threadpool(search_collections_paginated, query, page)


@router.get("/{collection_id}")
async def collection_detail(collection_id: int):
    data = await run_in_threadpool(get_collection, collection_id)
    if not data:
        raise HTTPException(status_code=404, detail="Collection not found")
    return data
