import time
import httpx
from app.config import settings

_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 3600  # 1 hour — conserves the 100 req/day free tier limit

NEWSAPI_BASE = "https://newsapi.org/v2"


def _fetch(cache_key: str, endpoint: str, params: dict) -> dict:
    now = time.time()
    if cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < CACHE_TTL:
            return data

    api_key = settings.NEWS_API_KEY
    if not api_key:
        return {"articles": [], "totalResults": 0}

    try:
        r = httpx.get(
            f"{NEWSAPI_BASE}/{endpoint}",
            params={**params, "apiKey": api_key},
            timeout=10,
        )
        if not r.is_success:
            return {"articles": [], "totalResults": 0}
        data = r.json()
        if data.get("status") != "ok":
            return {"articles": [], "totalResults": 0}
        _cache[cache_key] = (now, data)
        return data
    except Exception:
        return {"articles": [], "totalResults": 0}


def get_entertainment_news(page: int = 1, page_size: int = 20) -> dict:
    return _fetch(
        f"entertainment:{page}:{page_size}",
        "top-headlines",
        {"category": "entertainment", "language": "en", "page": page, "pageSize": page_size},
    )


def get_movie_news(page: int = 1, page_size: int = 20) -> dict:
    return _fetch(
        f"movies:{page}:{page_size}",
        "everything",
        {
            "q": "movies OR film OR cinema OR \"box office\"",
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )


def get_tv_news(page: int = 1, page_size: int = 20) -> dict:
    return _fetch(
        f"tv:{page}:{page_size}",
        "everything",
        {
            "q": "\"TV show\" OR \"television series\" OR \"streaming series\" OR \"season premiere\" OR \"season finale\" OR \"series cancelled\" OR \"series renewed\" OR \"show cancelled\" OR \"show renewed\" OR \"TV series\"",
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )


def search_news(query: str, page: int = 1, page_size: int = 20) -> dict:
    return _fetch(
        f"search:{query}:{page}:{page_size}",
        "everything",
        {
            "q": query,
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )
