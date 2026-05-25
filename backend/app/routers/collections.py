from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.collection_service import (
    browse_collections,
    get_collection_detail,
    get_collection_stats,
    get_rankings,
    get_user_collection_overview,
    get_watch_status,
    get_watch_status_bulk,
    list_genres_in_collections,
    search_collections,
    set_rankings,
)

router = APIRouter()


@router.get("/mine")
def my_collections(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Collections the current user has favorited, finished, or is watching."""
    return get_user_collection_overview(db, uid)


@router.get("/genres")
async def collection_genres(db: Session = Depends(get_db)):
    """Genres that appear across the collection catalog (drives the filter UI)."""
    return {"genres": await run_in_threadpool(list_genres_in_collections, db)}


@router.get("/browse")
async def browse(
    min_size: int | None = Query(None, ge=1),
    max_size: int | None = Query(None, ge=1),
    min_rating: float | None = Query(None, ge=0, le=10),
    year_from: int | None = Query(None, ge=1800, le=2200),
    year_to: int | None = Query(None, ge=1800, le=2200),
    genre_id: int | None = Query(None),
    sort: str = Query("name", pattern="^(name|size|rating|popularity|earliest|latest)$"),
    direction: str | None = Query(None, pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return await run_in_threadpool(
        browse_collections,
        db,
        min_size=min_size,
        max_size=max_size,
        min_rating=min_rating,
        year_from=year_from,
        year_to=year_to,
        genre_id=genre_id,
        sort=sort,
        direction=direction,
        page=page,
        page_size=page_size,
    )


@router.get("/search")
async def search(
    query: str,
    limit: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
):
    results = await run_in_threadpool(search_collections, db, query, limit)
    return {
        "results": [
            {
                "id": c.id,
                "name": c.name,
                "poster_path": c.poster_path,
                "backdrop_path": c.backdrop_path,
            }
            for c in results
        ]
    }


@router.get("/{collection_id}")
async def collection_detail(collection_id: int):
    data = await run_in_threadpool(get_collection_detail, collection_id)
    if not data:
        raise HTTPException(status_code=404, detail="Collection not found")
    return data


@router.get("/{collection_id}/stats")
async def collection_stats(collection_id: int, db: Session = Depends(get_db)):
    stats = await run_in_threadpool(get_collection_stats, db, collection_id)
    if stats is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return stats


@router.post("/status/bulk")
def collection_status_bulk(
    collection_ids: list[int] = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return per-collection progress for a batch of IDs in a single query."""
    if not collection_ids:
        return {}
    if len(collection_ids) > 200:
        collection_ids = collection_ids[:200]
    # Stringify keys so JSON consumers get string-keyed object as usual.
    return {
        str(cid): status
        for cid, status in get_watch_status_bulk(db, uid, collection_ids).items()
    }


@router.get("/{collection_id}/status")
def collection_status(
    collection_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    status = get_watch_status(db, uid, collection_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return status


@router.get("/{collection_id}/ranking")
def collection_ranking(
    collection_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return {"ranking": get_rankings(db, uid, collection_id)}


@router.put("/{collection_id}/ranking")
def update_collection_ranking(
    collection_id: int,
    ordered_movie_ids: list[int] = Body(..., embed=True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    try:
        ranking = set_rankings(db, uid, collection_id, ordered_movie_ids)
    except ValueError as e:
        msg = str(e)
        if msg == "collection_not_found":
            raise HTTPException(status_code=404, detail="Collection not found")
        raise HTTPException(status_code=400, detail=msg)
    return {"ranking": ranking}
