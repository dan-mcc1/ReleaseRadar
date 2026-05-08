from fastapi import APIRouter, Query
from app.services.news_service import (
    get_entertainment_news,
    get_movie_news,
    get_tv_news,
    search_news,
)

router = APIRouter()


@router.get("/")
def get_news(
    category: str = Query("entertainment", description="entertainment | movies | tv"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=40),
    q: str | None = Query(None),
):
    if q:
        return search_news(q, page, page_size)
    if category == "movies":
        return get_movie_news(page, page_size)
    if category == "tv":
        return get_tv_news(page, page_size)
    return get_entertainment_news(page, page_size)
